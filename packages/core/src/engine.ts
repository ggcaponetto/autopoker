import type { ActionStep, Profile, Region, RegionRunState } from '@autopoker/shared';
import { evaluateCondition } from './conditions';
import { cropRgba } from './frame';
import type {
  ActionQueueLike,
  BaselineProvider,
  Decider,
  Frame,
  InputController,
  RegionEvaluation,
  ScreenCapturer,
} from './types';

export type EngineStopReason = 'user' | 'hotkey' | 'corner' | 'error';

export interface EngineEvents {
  onRegionStatus?(status: {
    regionId: string;
    matched: boolean;
    state: RegionRunState;
    value?: number;
  }): void;
  onTriggered?(event: {
    regionId: string;
    regionName: string;
    at: number;
    dryRun: boolean;
    steps: ActionStep[];
  }): void;
  onLog?(level: 'info' | 'warn' | 'error', message: string): void;
  onStopped?(reason: EngineStopReason): void;
}

interface RegionRuntime {
  phase: RegionRunState;
  consecutiveMatches: number;
  cooldownUntil: number;
  clearedSinceTrigger: boolean;
}

export interface EngineDeps {
  capturer: ScreenCapturer;
  decider: Decider;
  queue: ActionQueueLike;
  baselines: BaselineProvider;
  /** Needed for the corner failsafe; omit to disable it regardless of settings. */
  input?: InputController;
  events?: EngineEvents;
  now?: () => number;
}

const CORNER_TOLERANCE_PX = 5;

/**
 * The tick loop: capture referenced monitors, evaluate each enabled region's condition,
 * advance the per-region state machine (armed → confirming → cooldown), and hand
 * triggered regions to the decider/queue unless in dry-run.
 *
 * Uses a setTimeout chain, never setInterval: the next tick is only scheduled after the
 * current one completes, so a slow capture can never overlap the next tick.
 */
export class MonitoringEngine {
  private profile: Profile | null = null;
  private readonly runtimes = new Map<string, RegionRuntime>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private tickCount = 0;
  private dryRunFlag = true;
  /** Timestamp of the last decider consultation, used for the LLM rate limit. */
  private lastDecisionAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly deps: EngineDeps) {}

  get running(): boolean {
    return this.profile !== null;
  }

  get activeProfile(): Profile | null {
    return this.profile;
  }

  get dryRun(): boolean {
    return this.dryRunFlag;
  }

  setDryRun(enabled: boolean): void {
    this.dryRunFlag = enabled;
  }

  start(profile: Profile): void {
    if (this.running) this.stop('user');
    this.profile = profile;
    this.dryRunFlag = profile.settings.dryRun;
    this.tickCount = 0;
    this.lastDecisionAt = Number.NEGATIVE_INFINITY;
    this.runtimes.clear();
    for (const region of profile.regions) {
      this.runtimes.set(region.id, {
        phase: 'armed',
        consecutiveMatches: 0,
        cooldownUntil: 0,
        clearedSinceTrigger: true,
      });
    }
    this.deps.events?.onLog?.('info', `engine started: profile "${profile.name}"`);
    this.scheduleNext(0);
  }

  stop(reason: EngineStopReason = 'user'): void {
    if (!this.running) return;
    this.profile = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.deps.queue.clear();
    this.deps.events?.onStopped?.(reason);
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private scheduleNext(delayMs: number): void {
    if (!this.profile) return;
    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    const profile = this.profile;
    if (!profile) return;
    try {
      if (profile.settings.cornerFailsafe && this.deps.input) {
        const pos = this.deps.input.getMousePos();
        if (Math.abs(pos.x) <= CORNER_TOLERANCE_PX && Math.abs(pos.y) <= CORNER_TOLERANCE_PX) {
          this.deps.events?.onLog?.('warn', 'corner failsafe tripped, stopping');
          this.stop('corner');
          return;
        }
      }

      const now = this.now();
      const regions = profile.regions.filter((region) => region.enabled);
      const frames = await this.captureFrames(regions);
      const evaluations: RegionEvaluation[] = [];

      for (const region of regions) {
        const frame = frames.get(region.monitorKey);
        if (!frame) continue;
        const regionFrame = cropRgba(frame, region.rect);
        if (!regionFrame) {
          this.deps.events?.onLog?.('warn', `region "${region.name}" is outside its monitor`);
          continue;
        }
        const result = evaluateCondition(region.condition, regionFrame, this.deps.baselines);
        const triggered = this.advance(region, result.matched, now);
        evaluations.push({ region, matched: result.matched, value: result.value, triggered });

        const runtime = this.runtimes.get(region.id);
        if (runtime) {
          this.deps.events?.onRegionStatus?.({
            regionId: region.id,
            matched: result.matched,
            state: runtime.phase,
            value: result.value,
          });
        }
      }

      for (const evaluation of evaluations) {
        if (!evaluation.triggered) continue;
        this.deps.events?.onTriggered?.({
          regionId: evaluation.region.id,
          regionName: evaluation.region.name,
          at: now,
          dryRun: this.dryRunFlag,
          steps: evaluation.region.actions,
        });
      }

      if (this.shouldDecide(profile, evaluations, now)) {
        this.lastDecisionAt = now;
        // Awaited: the decider may call a model, and awaiting inside the tick is what
        // guarantees only one model call is ever in flight.
        const requests = await this.deps.decider.decide({
          tick: this.tickCount,
          now,
          evaluations,
          frames,
        });
        // The decider still runs in dry-run so the UI can show what would have happened;
        // only the enqueue is suppressed.
        if (!this.dryRunFlag) {
          for (const request of requests) {
            if (!this.deps.queue.enqueue(request)) {
              this.deps.events?.onLog?.(
                'warn',
                `action queue busy, dropped trigger for "${request.regionName}"`,
              );
            }
          }
        }
      }
      this.tickCount += 1;
    } catch (error) {
      this.deps.events?.onLog?.('error', `tick failed: ${String(error)}`);
    } finally {
      this.scheduleNext(profile.settings.intervalMs);
    }
  }

  /**
   * Manual mode consults the decider whenever a region fires. LLM mode adds a rate
   * limit — the main cost control — and can optionally poll on every tick instead of
   * waiting for a region to fire.
   */
  private shouldDecide(profile: Profile, evaluations: RegionEvaluation[], now: number): boolean {
    const anyTriggered = evaluations.some((evaluation) => evaluation.triggered);
    if (profile.settings.mode === 'manual') return anyTriggered;
    if (now - this.lastDecisionAt < profile.settings.llm.minIntervalMs) return false;
    return profile.settings.llmTrigger === 'everyTick' || anyTriggered;
  }

  private async captureFrames(regions: Region[]): Promise<Map<string, Frame>> {
    const frames = new Map<string, Frame>();
    for (const key of new Set(regions.map((region) => region.monitorKey))) {
      try {
        frames.set(key, await this.deps.capturer.capture(key));
      } catch (error) {
        this.deps.events?.onLog?.('warn', `capture failed for ${key}: ${String(error)}`);
      }
    }
    return frames;
  }

  /** Advance the region's state machine with this tick's match result. True = fire now. */
  private advance(region: Region, matched: boolean, now: number): boolean {
    const runtime = this.runtimes.get(region.id);
    if (!runtime) return false;
    switch (runtime.phase) {
      case 'armed':
      case 'confirming': {
        if (!matched) {
          runtime.phase = 'armed';
          runtime.consecutiveMatches = 0;
          return false;
        }
        runtime.consecutiveMatches += 1;
        if (runtime.consecutiveMatches >= region.confirmTicks) {
          runtime.phase = 'cooldown';
          runtime.consecutiveMatches = 0;
          runtime.cooldownUntil = now + region.cooldownMs;
          runtime.clearedSinceTrigger = false;
          return true;
        }
        runtime.phase = 'confirming';
        return false;
      }
      case 'cooldown': {
        if (!matched) runtime.clearedSinceTrigger = true;
        const cooldownOver = now >= runtime.cooldownUntil;
        const cleared = region.rearm === 'afterCooldown' || runtime.clearedSinceTrigger;
        if (cooldownOver && cleared) {
          runtime.phase = 'armed';
          runtime.consecutiveMatches = 0;
        }
        return false;
      }
    }
  }
}
