import {
  ActionQueue,
  LlmDecider,
  MonitoringEngine,
  RegionRuleDecider,
  ScaledCoordinateMapper,
  StepActionExecutor,
  type ActionRequest,
  type BaselineStore,
  type Decider,
  type InputController,
  type ScreenCapturer,
  type StrategyStore,
} from '@autopoker/core';
import { startKillSwitch, type KillSwitchHandle } from '@autopoker/core/adapters';
import {
  AiSdkDecisionSource,
  MockDecisionSource,
  type DecisionSource,
  type StrategyContext,
} from '@autopoker/llm';
import { rectCenter, type EngineState, type Profile, type ServerMessage } from '@autopoker/shared';
import type { EngineControl } from './handlers';

const CORNER_TOLERANCE_PX = 5;

type StrategyContextValue = StrategyContext | null;

/**
 * Owns the MonitoringEngine plus its live wiring: kill switch lifecycle, corner-guarded
 * step execution, region status change detection, and event broadcasting.
 */
/** Sends mock-provider requests to the scripted source and everything else to a real model. */
class RoutingDecisionSource implements DecisionSource {
  private readonly mock = new MockDecisionSource();
  private readonly real = new AiSdkDecisionSource();

  decide(request: Parameters<DecisionSource['decide']>[0]) {
    return request.settings.provider === 'mock'
      ? this.mock.decide(request)
      : this.real.decide(request);
  }
}

export class EngineController implements EngineControl {
  private readonly engine: MonitoringEngine;
  private readonly queue: ActionQueue;
  private readonly ruleDecider: Decider;
  private readonly llmDecider: Decider;
  private killSwitch: KillSwitchHandle | null = null;
  private killFlag = false;
  private mapper = new ScaledCoordinateMapper([]);
  private readonly lastStatus = new Map<string, string>();
  /** Strategy files are read once per run, not once per tick. */
  private contextCache: { strategyId: string; context: StrategyContextValue } | null = null;

  constructor(
    private readonly capturer: ScreenCapturer,
    private readonly input: InputController,
    baselines: BaselineStore,
    private readonly strategies: StrategyStore,
    private readonly broadcast: (message: ServerMessage) => void,
  ) {
    const executor = new StepActionExecutor(input, { guard: () => this.stepAllowed() });
    this.queue = new ActionQueue(executor, {
      onError: (request, error) =>
        this.log('error', `actions failed for "${request.regionName}": ${String(error)}`),
    });
    const mapper = {
      toScreen: (key: string, point: { x: number; y: number }) => this.mapper.toScreen(key, point),
    };
    this.ruleDecider = new RegionRuleDecider(mapper);
    this.llmDecider = new LlmDecider({
      source: new RoutingDecisionSource(),
      capturer,
      mapper,
      getProfile: () => this.engine.activeProfile,
      loadContext: () => this.loadStrategyContext(),
      isDryRun: () => this.engine.dryRun,
      onDecision: (record) => this.broadcast({ type: 'llmDecision', record }),
      onLog: (level, message) => this.log(level, message),
    });
    this.engine = new MonitoringEngine({
      capturer,
      // Routed per tick so switching a profile between manual and llm mode takes
      // effect without rebuilding the engine.
      decider: {
        decide: (input) =>
          this.engine.activeProfile?.settings.mode === 'llm'
            ? this.llmDecider.decide(input)
            : this.ruleDecider.decide(input),
      },
      queue: this.queue,
      baselines,
      input,
      events: {
        onRegionStatus: (status) => {
          // Only broadcast on change; value changes below 1 unit are noise.
          const fingerprint = `${status.matched}|${status.state}|${Math.round(status.value ?? -1)}`;
          if (this.lastStatus.get(status.regionId) === fingerprint) return;
          this.lastStatus.set(status.regionId, fingerprint);
          this.broadcast({ type: 'regionStatus', ...status });
        },
        onTriggered: (event) => this.broadcast({ type: 'triggered', ...event }),
        onLog: (level, message) => this.log(level, message),
        onStopped: (reason) => {
          this.disarmKillSwitch();
          if (reason === 'hotkey' || reason === 'corner') {
            this.broadcast({ type: 'killSwitch', reason });
          }
          this.broadcast({ type: 'engineState', state: this.state() });
        },
      },
    });
    this.baselineStore = baselines;
  }

  private readonly baselineStore: BaselineStore;

  async prepare(profile: Profile): Promise<void> {
    this.mapper = new ScaledCoordinateMapper(await this.capturer.listMonitors());
    const baselineIds = profile.regions
      .map((region) => region.condition)
      .flatMap((condition) => ('baselineId' in condition ? [condition.baselineId] : []));
    await this.baselineStore.loadAll(baselineIds);
  }

  /** Read the active profile's strategy once per run and reuse it for every tick. */
  private async loadStrategyContext(): Promise<StrategyContextValue> {
    const strategyId = this.engine.activeProfile?.settings.strategyId;
    if (!strategyId) return null;
    if (this.contextCache?.strategyId === strategyId) return this.contextCache.context;
    const context = await this.strategies.loadContext(strategyId);
    if (!context) this.log('warn', `strategy "${strategyId}" was not found on disk`);
    this.contextCache = { strategyId, context };
    return context;
  }

  async start(profile: Profile): Promise<void> {
    this.contextCache = null;
    await this.prepare(profile);
    if (profile.settings.mode === 'llm') {
      const { provider, model } = profile.settings.llm;
      this.log('info', `llm mode: ${provider} / ${model}, trigger=${profile.settings.llmTrigger}`);
      if (!profile.settings.strategyId) {
        this.log('warn', 'llm mode with no strategy selected — the model has no instructions');
      }
    }
    this.killFlag = false;
    this.lastStatus.clear();
    this.armKillSwitch(profile.settings.killSwitchHotkey);
    this.engine.start(profile);
  }

  stop(): void {
    this.engine.stop('user');
  }

  setDryRun(enabled: boolean): void {
    this.engine.setDryRun(enabled);
  }

  state(): EngineState {
    const profile = this.engine.activeProfile;
    return {
      running: this.engine.running,
      dryRun: this.engine.dryRun,
      profileId: profile?.id ?? null,
      intervalMs: profile?.settings.intervalMs ?? null,
      killSwitchArmed: this.killSwitch !== null,
    };
  }

  /** Run one region's actions once through the shared queue (so it can't interleave). */
  async testActions(profile: Profile, regionId: string): Promise<boolean> {
    const region = profile.regions.find((candidate) => candidate.id === regionId);
    if (!region) return false;
    await this.prepare(profile);
    this.killFlag = false;
    const request: ActionRequest = {
      regionId: region.id,
      regionName: region.name,
      steps: region.actions,
      regionCenter: this.mapper.toScreen(region.monitorKey, rectCenter(region.rect)),
    };
    if (this.engine.dryRun) {
      this.broadcast({
        type: 'triggered',
        regionId: region.id,
        regionName: region.name,
        at: Date.now(),
        dryRun: true,
        steps: region.actions,
      });
      return true;
    }
    return this.queue.enqueue(request);
  }

  /**
   * Run exactly one model decision against a live screenshot and report it, without
   * executing anything. This is the tuning loop for strategies.
   */
  async testDecision(profile: Profile): Promise<void> {
    this.contextCache = null;
    await this.prepare(profile);
    const probe = new LlmDecider({
      source: new RoutingDecisionSource(),
      capturer: this.capturer,
      mapper: { toScreen: (key, point) => this.mapper.toScreen(key, point) },
      getProfile: () => profile,
      loadContext: () => this.strategies.loadContext(profile.settings.strategyId ?? ''),
      // A one-shot probe never acts, whatever the engine's live dry-run setting is.
      isDryRun: () => true,
      onDecision: (record) => this.broadcast({ type: 'llmDecision', record }),
      onLog: (level, message) => this.log(level, message),
    });
    await probe.decide({ tick: 0, now: Date.now(), evaluations: [], frames: new Map() });
  }

  private stepAllowed(): boolean {
    if (this.killFlag) return false;
    const pos = this.input.getMousePos();
    return !(Math.abs(pos.x) <= CORNER_TOLERANCE_PX && Math.abs(pos.y) <= CORNER_TOLERANCE_PX);
  }

  private armKillSwitch(hotkey: string): void {
    this.disarmKillSwitch();
    try {
      this.killSwitch = startKillSwitch(hotkey, () => {
        this.killFlag = true;
        this.queue.clear();
        this.engine.stop('hotkey');
      });
    } catch (error) {
      this.log('warn', `kill switch unavailable: ${String(error)}`);
    }
  }

  private disarmKillSwitch(): void {
    this.killSwitch?.stop();
    this.killSwitch = null;
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    this.broadcast({ type: 'log', level, message, at: Date.now() });
  }
}
