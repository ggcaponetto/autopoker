import {
  rectCenter,
  type ActionStep,
  type LlmAction,
  type LlmClickMarker,
  type LlmDecision,
  type LlmDecisionRecord,
  type LlmSentScreenshot,
  type Point,
  type Profile,
  type Region,
} from '@autopoker/shared';
// Type-only: erased at compile time, so core never loads the AI SDK at runtime.
import type {
  DecisionRequest,
  DecisionSource,
  HistoryEntry,
  Landmark,
  ScreenshotInput,
  StrategyContext,
} from '@autopoker/llm';
import type {
  ActionRequest,
  CoordinateMapper,
  Decider,
  DeciderInput,
  ScreenCapturer,
} from './types';

export interface LlmDeciderDeps {
  source: DecisionSource;
  capturer: ScreenCapturer;
  mapper: CoordinateMapper;
  /** The profile currently running; re-read each tick so settings edits take effect. */
  getProfile(): Profile | null;
  /** Strategy markdown and attachments, loaded and cached by the caller. */
  loadContext(): Promise<StrategyContext | null>;
  /**
   * Whether the engine is currently suppressing execution. The decider needs this so
   * the reported record matches what actually happened — otherwise a dry-run decision
   * is logged as "executed" when nothing was clicked.
   */
  isDryRun(): boolean;
  onDecision?(record: LlmDecisionRecord): void;
  onLog?(level: 'info' | 'warn' | 'error', message: string): void;
  now?(): number;
}

/** Why a decision produced no executable steps. */
type Rejection = { reason: string };

function isRejection(value: unknown): value is Rejection {
  return typeof value === 'object' && value !== null && 'reason' in value;
}

function summarize(actions: LlmAction[]): string {
  if (actions.length === 0) return 'nothing';
  return actions
    .map((action) => (action.regionName ? `${action.type}(${action.regionName})` : action.type))
    .join(' then ');
}

/**
 * Asks a model what to do and translates its answer into executable steps.
 *
 * Translation is all-or-nothing: if any action fails to resolve (an unknown region
 * name, an off-screen point) the whole decision is rejected rather than partially
 * executed, because half of a plan ("click Raise, type 100, press enter") is more
 * dangerous than none of it.
 */
export class LlmDecider implements Decider {
  private readonly history: HistoryEntry[] = [];

  constructor(private readonly deps: LlmDeciderDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  async decide(input: DeciderInput): Promise<ActionRequest[]> {
    const profile = this.deps.getProfile();
    if (!profile) return [];
    const settings = profile.settings.llm;

    let request: DecisionRequest;
    try {
      request = await this.buildRequest(profile, input);
    } catch (error) {
      this.deps.onLog?.('error', `could not prepare the model request: ${String(error)}`);
      return [];
    }

    // Kept on every record — including failures — so "what did the model actually
    // see?" is always answerable from the UI.
    const sentScreenshots: LlmSentScreenshot[] = request.screenshots.map((shot) => ({
      label: shot.label,
      monitorKey: shot.monitorKey,
      originX: shot.originX,
      originY: shot.originY,
      jpegBase64: Buffer.from(shot.data).toString('base64'),
      captureWidth: shot.captureWidth,
      captureHeight: shot.captureHeight,
    }));

    const startedAt = this.now();
    let decision: LlmDecision;
    let latencyMs: number;
    let model: string;
    let usage: LlmDecisionRecord['usage'];
    try {
      const result = await this.deps.source.decide(request);
      decision = result.decision;
      latencyMs = result.latencyMs;
      model = result.model;
      usage = result.usage;
    } catch (error) {
      this.deps.onLog?.('error', `model call failed: ${String(error)}`);
      this.deps.onDecision?.({
        at: startedAt,
        decision: { observation: '', reasoning: String(error), confidence: 0, actions: [] },
        steps: [],
        executed: false,
        skippedReason: 'model call failed',
        screenshots: sentScreenshots,
        markers: [],
        latencyMs: this.now() - startedAt,
        model: settings.model,
        usage: undefined,
      });
      return [];
    }

    const translated = this.translate(decision, profile);
    const belowConfidence = decision.confidence < settings.minConfidence;
    const dryRun = this.deps.isDryRun();

    let skippedReason: string | undefined;
    if (belowConfidence) {
      skippedReason = `confidence ${decision.confidence.toFixed(2)} is below the ${settings.minConfidence} threshold`;
    } else if (isRejection(translated)) {
      skippedReason = translated.reason;
    } else if (translated.length === 0) {
      skippedReason = 'the model chose to wait';
    }

    const steps = !belowConfidence && !isRejection(translated) ? translated : [];
    const runnable = steps.length > 0 && skippedReason === undefined;
    if (runnable && dryRun) skippedReason = 'dry-run: the actions were not performed';
    const executed = runnable && !dryRun;

    this.deps.onDecision?.({
      at: startedAt,
      decision,
      steps,
      executed,
      skippedReason,
      screenshots: sentScreenshots,
      markers: this.markersFor(decision, profile, request),
      latencyMs,
      model,
      usage,
    });

    if (skippedReason) this.deps.onLog?.('info', `decision not executed: ${skippedReason}`);
    // Every decision is remembered — waits and skips included — because the sequence
    // of observations is the model's only memory of the current hand. Entries carry
    // an honest executed flag so it never mistakes a skipped plan for a past action.
    this.remember(decision, settings.historySize, executed, skippedReason);
    // Nothing is returned to the engine in dry-run either: it would drop it anyway.
    if (!executed) return [];

    return [
      {
        regionId: 'llm',
        regionName: `model (${model})`,
        steps,
        // Every step already carries absolute coordinates, so this is only a fallback.
        regionCenter: { x: 0, y: 0 },
      },
    ];
  }

  /**
   * Where each click/move would land, drawn on the sent screenshots. Best-effort by
   * design: computed even when the decision is later rejected or skipped, because
   * that is exactly when you want to see the aim.
   */
  private markersFor(
    decision: LlmDecision,
    profile: Profile,
    request: DecisionRequest,
  ): LlmClickMarker[] {
    const markers: LlmClickMarker[] = [];
    // A monitor-space point lands on whichever sent screenshot contains it.
    const place = (monitorKey: string, point: Point, label: string) => {
      const shot = request.screenshots.find(
        (candidate) =>
          candidate.monitorKey === monitorKey &&
          point.x >= candidate.originX &&
          point.x < candidate.originX + candidate.captureWidth &&
          point.y >= candidate.originY &&
          point.y < candidate.originY + candidate.captureHeight,
      );
      if (!shot) return;
      markers.push({
        screenshotLabel: shot.label,
        x: point.x - shot.originX,
        y: point.y - shot.originY,
        label,
      });
    };

    decision.actions.forEach((action, index) => {
      if (action.type === 'clickRegion' && action.regionName) {
        const wanted = action.regionName.trim().toLowerCase();
        const region = profile.regions.find(
          (candidate) => candidate.name.trim().toLowerCase() === wanted,
        );
        if (!region) return;
        place(region.monitorKey, rectCenter(region.rect), `${index + 1}. click "${region.name}"`);
        return;
      }
      if (
        (action.type === 'clickPoint' || action.type === 'moveMouse') &&
        typeof action.x === 'number' &&
        typeof action.y === 'number'
      ) {
        const verb = action.type === 'moveMouse' ? 'move to' : 'click';
        const label = `${index + 1}. ${verb} (${Math.round(action.x)}, ${Math.round(action.y)})`;
        const resolved = this.resolveCapturePoint(action, profile);
        if (!isRejection(resolved)) {
          place(resolved.monitorKey, resolved.point, label);
        } else if (request.screenshots.length === 1) {
          // Unresolvable but unambiguous: draw it on the only image the model saw.
          const only = request.screenshots[0]!;
          markers.push({
            screenshotLabel: only.label,
            x: Math.round(action.x),
            y: Math.round(action.y),
            label,
          });
        }
      }
    });
    return markers;
  }

  private remember(
    decision: LlmDecision,
    historySize: number,
    executed: boolean,
    skippedReason: string | undefined,
  ): void {
    if (historySize <= 0) return;
    const base = summarize(decision.actions);
    // Choosing to wait is not a failed action: it is exactly what happened.
    const waited = base === 'wait' || base === 'nothing';
    this.history.push({
      at: this.now(),
      observation: decision.observation,
      actionSummary: executed || waited ? base : `${base} — ${skippedReason ?? 'skipped'}`,
      executed: executed || waited,
    });
    while (this.history.length > historySize) this.history.shift();
  }

  /** Enabled regions whose purpose is to define what the model sees. */
  private viewRegions(profile: Profile): Region[] {
    return profile.regions.filter((region) => region.enabled && region.purpose === 'view');
  }

  private async buildRequest(profile: Profile, input: DeciderInput): Promise<DecisionRequest> {
    const settings = profile.settings.llm;
    const regions = profile.regions.filter((region) => region.enabled);
    const monitors = await this.deps.capturer.listMonitors();
    const screenshots: ScreenshotInput[] = [];

    // View regions win: sending only the interesting crop is the main latency lever,
    // since vision cost scales with pixels. Without views, whole monitors are sent
    // per the settings selection (null = every monitor) — never inferred from
    // regions or live frames: a profile with no regions must still send something.
    const views = this.viewRegions(profile);
    if (views.length > 0) {
      for (const view of views) {
        if (!monitors.some((monitor) => monitor.key === view.monitorKey)) {
          this.deps.onLog?.(
            'warn',
            `view "${view.name}" is on disconnected monitor "${view.monitorKey}"; skipping it`,
          );
          continue;
        }
        screenshots.push({
          label: view.name,
          monitorKey: view.monitorKey,
          originX: view.rect.x,
          originY: view.rect.y,
          mediaType: 'image/jpeg',
          data: await this.deps.capturer.captureJpegRect(view.monitorKey, view.rect),
          captureWidth: view.rect.width,
          captureHeight: view.rect.height,
        });
      }
    } else {
      const keysToShoot =
        settings.monitorKeys === null
          ? monitors.map((monitor) => monitor.key)
          : [...new Set(settings.monitorKeys)];
      for (const key of keysToShoot) {
        const monitor = monitors.find((candidate) => candidate.key === key);
        if (!monitor) {
          this.deps.onLog?.('warn', `selected screen "${key}" is not connected; skipping it`);
          continue;
        }
        screenshots.push({
          label: key,
          monitorKey: key,
          originX: 0,
          originY: 0,
          mediaType: 'image/jpeg',
          data: await this.deps.capturer.captureJpeg(key),
          captureWidth: monitor.captureWidth,
          captureHeight: monitor.captureHeight,
        });
      }
    }
    if (screenshots.length === 0) {
      this.deps.onLog?.(
        'warn',
        'no screenshots will be sent — the model is blind; check the screens selection in the model tab',
      );
    }

    const landmarks: Landmark[] = regions
      .filter((region) => region.purpose !== 'view')
      .map((region) => ({
        name: region.name,
        description: region.description,
        monitorKey: region.monitorKey,
        rect: region.rect,
      }));

    const triggeredRegionNames = input.evaluations
      .filter((evaluation) => evaluation.triggered)
      .map((evaluation) => evaluation.region.name);

    return {
      settings,
      context: await this.deps.loadContext(),
      screenshots,
      landmarks,
      history: [...this.history],
      triggeredRegionNames,
      at: this.now(),
    };
  }

  /** Resolve model actions into steps with absolute screen coordinates. */
  private translate(decision: LlmDecision, profile: Profile): ActionStep[] | Rejection {
    const settings = profile.settings.llm;
    const actions = decision.actions.filter((action) => action.type !== 'wait');
    if (actions.length > settings.maxActionsPerDecision) {
      return {
        reason: `the model returned ${actions.length} actions, above the cap of ${settings.maxActionsPerDecision}`,
      };
    }

    const steps: ActionStep[] = [];
    for (const action of actions) {
      const step = this.translateAction(action, profile);
      if (isRejection(step)) return step;
      steps.push(step);
    }
    return steps;
  }

  private translateAction(action: LlmAction, profile: Profile): ActionStep | Rejection {
    switch (action.type) {
      case 'clickRegion':
      case 'clickPoint':
      case 'moveMouse': {
        const point =
          action.type === 'clickRegion'
            ? this.resolveRegionCenter(action, profile)
            : this.resolvePoint(action, profile);
        if (isRejection(point)) return point;
        if (action.type === 'moveMouse') return { type: 'moveMouse', target: point };
        return {
          type: 'click',
          button: action.button ?? 'left',
          double: action.double ?? false,
          target: point,
        };
      }
      case 'typeText':
        if (typeof action.text !== 'string') return { reason: 'typeText action had no text' };
        return { type: 'typeText', text: action.text };
      case 'keyTap':
        if (!action.key) return { reason: 'keyTap action had no key' };
        return { type: 'keyTap', key: action.key, modifiers: action.modifiers ?? [] };
      case 'delay':
        return { type: 'delay', ms: Math.min(Math.max(action.ms ?? 0, 0), 60_000) };
      case 'wait':
        return { reason: 'wait is filtered out before translation' };
    }
  }

  private resolveRegionCenter(action: LlmAction, profile: Profile): Point | Rejection {
    if (!action.regionName) return { reason: 'clickRegion action had no regionName' };
    const wanted = action.regionName.trim().toLowerCase();
    const region: Region | undefined = profile.regions.find(
      (candidate) => candidate.name.trim().toLowerCase() === wanted,
    );
    if (!region) return { reason: `the model referenced unknown region "${action.regionName}"` };
    return this.toScreen(region.monitorKey, rectCenter(region.rect));
  }

  private resolvePoint(action: LlmAction, profile: Profile): Point | Rejection {
    const resolved = this.resolveCapturePoint(action, profile);
    if (isRejection(resolved)) return resolved;
    return this.toScreen(resolved.monitorKey, resolved.point);
  }

  /**
   * Turn a clickPoint/moveMouse action into a monitor + capture-space point. The
   * action's monitorKey may name a view region — the model gives coordinates within
   * the crop it saw, and the view's offset translates them back to the monitor.
   */
  private resolveCapturePoint(
    action: LlmAction,
    profile: Profile,
  ): { monitorKey: string; point: Point } | Rejection {
    if (typeof action.x !== 'number' || typeof action.y !== 'number') {
      return { reason: `${action.type} action had no coordinates` };
    }
    const point = { x: Math.round(action.x), y: Math.round(action.y) };
    const views = this.viewRegions(profile);
    const inView = (view: Region) => ({
      monitorKey: view.monitorKey,
      point: { x: view.rect.x + point.x, y: view.rect.y + point.y },
    });

    if (action.monitorKey) {
      const wanted = action.monitorKey.trim().toLowerCase();
      const view = views.find((candidate) => candidate.name.trim().toLowerCase() === wanted);
      return view ? inView(view) : { monitorKey: action.monitorKey, point };
    }
    // No key given: an unambiguous single view wins, then the first region's monitor.
    if (views.length === 1) return inView(views[0]!);
    const fallback = profile.regions[0]?.monitorKey;
    if (!fallback) return { reason: `${action.type} action had no monitorKey` };
    return { monitorKey: fallback, point };
  }

  private toScreen(monitorKey: string, point: Point): Point | Rejection {
    try {
      return this.deps.mapper.toScreen(monitorKey, point);
    } catch {
      return { reason: `unknown monitor "${monitorKey}"` };
    }
  }
}
