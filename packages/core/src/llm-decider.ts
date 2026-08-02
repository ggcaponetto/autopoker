import {
  rectCenter,
  type ActionStep,
  type LlmAction,
  type LlmDecision,
  type LlmDecisionRecord,
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
      latencyMs,
      model,
      usage,
    });

    if (skippedReason) this.deps.onLog?.('info', `decision not executed: ${skippedReason}`);
    // Nothing is returned in dry-run either: the engine would drop it, and remembering
    // an action that never happened would mislead the model on the next turn.
    if (!executed) return [];

    this.remember(decision, settings.historySize);
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

  private remember(decision: LlmDecision, historySize: number): void {
    if (historySize <= 0) return;
    this.history.push({
      at: this.now(),
      observation: decision.observation,
      actionSummary: summarize(decision.actions),
    });
    while (this.history.length > historySize) this.history.shift();
  }

  private async buildRequest(profile: Profile, input: DeciderInput): Promise<DecisionRequest> {
    const settings = profile.settings.llm;
    const regions = profile.regions.filter((region) => region.enabled);
    const monitorKeys = [...new Set(regions.map((region) => region.monitorKey))];
    const keysToShoot = monitorKeys.length > 0 ? monitorKeys : [...input.frames.keys()];

    const monitors = await this.deps.capturer.listMonitors();
    const screenshots: ScreenshotInput[] = [];
    for (const key of keysToShoot) {
      const monitor = monitors.find((candidate) => candidate.key === key);
      if (!monitor) continue;
      screenshots.push({
        monitorKey: key,
        mediaType: 'image/jpeg',
        data: await this.deps.capturer.captureJpeg(key),
        captureWidth: monitor.captureWidth,
        captureHeight: monitor.captureHeight,
      });
    }

    const landmarks: Landmark[] = regions.map((region) => ({
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
    if (typeof action.x !== 'number' || typeof action.y !== 'number') {
      return { reason: `${action.type} action had no coordinates` };
    }
    const monitorKey = action.monitorKey ?? profile.regions[0]?.monitorKey;
    if (!monitorKey) return { reason: `${action.type} action had no monitorKey` };
    return this.toScreen(monitorKey, { x: Math.round(action.x), y: Math.round(action.y) });
  }

  private toScreen(monitorKey: string, point: Point): Point | Rejection {
    try {
      return this.deps.mapper.toScreen(monitorKey, point);
    } catch {
      return { reason: `unknown monitor "${monitorKey}"` };
    }
  }
}
