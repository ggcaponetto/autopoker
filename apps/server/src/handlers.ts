import type {
  ClientMessage,
  EngineState,
  MonitorInfo,
  Profile,
  Rect,
  ServerMessage,
} from '@autopoker/shared';

export interface ClientConnection {
  send(message: ServerMessage): void;
}

export interface EngineControl {
  start(profile: Profile): void | Promise<void>;
  stop(): void;
  setDryRun(enabled: boolean): void;
  state(): EngineState;
}

export interface ProfileStoreLike {
  list(): Promise<Profile[]>;
  get(profileId: string): Promise<Profile | undefined>;
  save(profile: Profile): Promise<void>;
  delete(profileId: string): Promise<void>;
}

export interface BaselineCapturedResult {
  baselineId: string;
  width: number;
  height: number;
  pngBase64: string;
}

export interface PreviewControl {
  subscribe(client: ClientConnection, monitorKey: string, maxFps?: number): void;
  unsubscribe(client: ClientConnection, monitorKey: string): void;
}

export interface HandlerContext {
  engine: EngineControl;
  profiles: ProfileStoreLike;
  preview: PreviewControl;
  listMonitors(): Promise<MonitorInfo[]>;
  captureBaseline(monitorKey: string, rect: Rect): Promise<BaselineCapturedResult>;
  /** Run one region's actions once (respecting dry-run). False when the region is unknown. */
  testActions(profile: Profile, regionId: string): Promise<boolean>;
  broadcast(message: ServerMessage): void;
}

export async function handleMessage(
  ctx: HandlerContext,
  client: ClientConnection,
  message: ClientMessage,
): Promise<void> {
  const { id } = message;
  try {
    switch (message.type) {
      case 'listMonitors':
        client.send({ id, type: 'monitors', list: await ctx.listMonitors() });
        break;
      case 'listProfiles':
        client.send({ id, type: 'profiles', list: await ctx.profiles.list() });
        break;
      case 'saveProfile':
        await ctx.profiles.save(message.profile);
        client.send({ id, type: 'ack' });
        ctx.broadcast({ type: 'profiles', list: await ctx.profiles.list() });
        break;
      case 'deleteProfile':
        await ctx.profiles.delete(message.profileId);
        client.send({ id, type: 'ack' });
        ctx.broadcast({ type: 'profiles', list: await ctx.profiles.list() });
        break;
      case 'start': {
        const profile = await ctx.profiles.get(message.profileId);
        if (!profile) {
          client.send({ id, type: 'error', message: `profile not found: ${message.profileId}` });
          return;
        }
        await ctx.engine.start(profile);
        client.send({ id, type: 'ack' });
        ctx.broadcast({ type: 'engineState', state: ctx.engine.state() });
        break;
      }
      case 'stop':
        ctx.engine.stop();
        client.send({ id, type: 'ack' });
        ctx.broadcast({ type: 'engineState', state: ctx.engine.state() });
        break;
      case 'setDryRun':
        ctx.engine.setDryRun(message.enabled);
        client.send({ id, type: 'ack' });
        ctx.broadcast({ type: 'engineState', state: ctx.engine.state() });
        break;
      case 'captureBaseline': {
        const captured = await ctx.captureBaseline(message.monitorKey, message.rect);
        client.send({ id, type: 'baselineCaptured', ...captured });
        break;
      }
      case 'subscribePreview':
        ctx.preview.subscribe(client, message.monitorKey, message.maxFps);
        client.send({ id, type: 'ack' });
        break;
      case 'unsubscribePreview':
        ctx.preview.unsubscribe(client, message.monitorKey);
        client.send({ id, type: 'ack' });
        break;
      case 'testActions': {
        const profile = await ctx.profiles.get(message.profileId);
        const ran = profile ? await ctx.testActions(profile, message.regionId) : false;
        if (ran) client.send({ id, type: 'ack' });
        else
          client.send({ id, type: 'error', message: 'region or profile not found, or queue busy' });
        break;
      }
    }
  } catch (error) {
    client.send({ id, type: 'error', message: String(error) });
  }
}
