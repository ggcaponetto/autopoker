import {
  ActionQueue,
  MonitoringEngine,
  RegionRuleDecider,
  ScaledCoordinateMapper,
  StepActionExecutor,
  type ActionRequest,
  type BaselineStore,
  type InputController,
  type ScreenCapturer,
} from '@autopoker/core';
import { startKillSwitch, type KillSwitchHandle } from '@autopoker/core/adapters';
import { rectCenter, type EngineState, type Profile, type ServerMessage } from '@autopoker/shared';
import type { EngineControl } from './handlers';

const CORNER_TOLERANCE_PX = 5;

/**
 * Owns the MonitoringEngine plus its live wiring: kill switch lifecycle, corner-guarded
 * step execution, region status change detection, and event broadcasting.
 */
export class EngineController implements EngineControl {
  private readonly engine: MonitoringEngine;
  private readonly queue: ActionQueue;
  private killSwitch: KillSwitchHandle | null = null;
  private killFlag = false;
  private mapper = new ScaledCoordinateMapper([]);
  private readonly lastStatus = new Map<string, string>();

  constructor(
    private readonly capturer: ScreenCapturer,
    private readonly input: InputController,
    baselines: BaselineStore,
    private readonly broadcast: (message: ServerMessage) => void,
  ) {
    const executor = new StepActionExecutor(input, { guard: () => this.stepAllowed() });
    this.queue = new ActionQueue(executor, {
      onError: (request, error) =>
        this.log('error', `actions failed for "${request.regionName}": ${String(error)}`),
    });
    this.engine = new MonitoringEngine({
      capturer,
      decider: new RegionRuleDecider({
        toScreen: (key, point) => this.mapper.toScreen(key, point),
      }),
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

  async start(profile: Profile): Promise<void> {
    await this.prepare(profile);
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
