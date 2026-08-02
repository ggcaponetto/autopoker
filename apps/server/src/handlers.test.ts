import {
  createDefaultSettings,
  ProfileSchema,
  type EngineState,
  type Profile,
  type ServerMessage,
} from '@autopoker/shared';
import { describe, expect, it } from 'vitest';
import { handleMessage, type ClientConnection, type HandlerContext } from './handlers';

const profile: Profile = ProfileSchema.parse({
  id: 'p1',
  name: 'Profile One',
  regions: [],
  settings: createDefaultSettings(),
});

function fakeClient() {
  const sent: ServerMessage[] = [];
  const client: ClientConnection = { send: (message) => sent.push(message) };
  return { client, sent };
}

function buildCtx(initialProfiles: Profile[] = []) {
  const calls: string[] = [];
  const broadcasts: ServerMessage[] = [];
  const store = new Map(initialProfiles.map((entry) => [entry.id, entry]));
  const state: EngineState = {
    running: false,
    dryRun: true,
    profileId: null,
    intervalMs: null,
    killSwitchArmed: false,
  };
  const ctx: HandlerContext = {
    engine: {
      start: (target) => {
        calls.push(`start:${target.id}`);
        state.running = true;
        state.profileId = target.id;
      },
      stop: () => {
        calls.push('stop');
        state.running = false;
        state.profileId = null;
      },
      setDryRun: (enabled) => {
        calls.push(`dryRun:${enabled}`);
        state.dryRun = enabled;
      },
      state: () => ({ ...state }),
    },
    profiles: {
      list: async () => [...store.values()],
      get: async (profileId) => store.get(profileId),
      save: async (target) => void store.set(target.id, target),
      delete: async (profileId) => void store.delete(profileId),
    },
    preview: {
      subscribe: (_client, monitorKey) => void calls.push(`subscribe:${monitorKey}`),
      unsubscribe: (_client, monitorKey) => void calls.push(`unsubscribe:${monitorKey}`),
    },
    listMonitors: async () => [],
    captureBaseline: async (monitorKey) => {
      if (monitorKey === 'ghost') throw new Error('no such monitor');
      return { baselineId: 'b1', width: 4, height: 4, pngBase64: 'cGc=' };
    },
    testActions: async (_profile, regionId) => regionId === 'r1',
    broadcast: (message) => broadcasts.push(message),
  };
  return { ctx, calls, broadcasts };
}

describe('handleMessage', () => {
  it('answers listProfiles with the request id', async () => {
    const { ctx } = buildCtx([profile]);
    const { client, sent } = fakeClient();
    await handleMessage(ctx, client, { id: 'q1', type: 'listProfiles' });
    expect(sent).toEqual([{ id: 'q1', type: 'profiles', list: [profile] }]);
  });

  it('saveProfile acks the caller and broadcasts the new list', async () => {
    const { ctx, broadcasts } = buildCtx();
    const { client, sent } = fakeClient();
    await handleMessage(ctx, client, { id: 'q2', type: 'saveProfile', profile });
    expect(sent).toEqual([{ id: 'q2', type: 'ack' }]);
    expect(broadcasts).toEqual([{ type: 'profiles', list: [profile] }]);
  });

  it('start rejects unknown profiles', async () => {
    const { ctx, calls } = buildCtx();
    const { client, sent } = fakeClient();
    await handleMessage(ctx, client, { id: 'q3', type: 'start', profileId: 'nope' });
    expect(sent[0]).toMatchObject({ id: 'q3', type: 'error' });
    expect(calls).toEqual([]);
  });

  it('start runs the engine and broadcasts the running state', async () => {
    const { ctx, calls, broadcasts } = buildCtx([profile]);
    const { client, sent } = fakeClient();
    await handleMessage(ctx, client, { id: 'q4', type: 'start', profileId: 'p1' });
    expect(calls).toEqual(['start:p1']);
    expect(sent).toEqual([{ id: 'q4', type: 'ack' }]);
    expect(broadcasts[0]).toMatchObject({
      type: 'engineState',
      state: { running: true, profileId: 'p1' },
    });
  });

  it('stop and setDryRun broadcast state transitions', async () => {
    const { ctx, calls, broadcasts } = buildCtx([profile]);
    const { client } = fakeClient();
    await handleMessage(ctx, client, { type: 'setDryRun', enabled: false });
    await handleMessage(ctx, client, { type: 'stop' });
    expect(calls).toEqual(['dryRun:false', 'stop']);
    expect(broadcasts.map((message) => message.type)).toEqual(['engineState', 'engineState']);
  });

  it('captureBaseline responds with the stored baseline', async () => {
    const { ctx } = buildCtx();
    const { client, sent } = fakeClient();
    await handleMessage(ctx, client, {
      id: 'q5',
      type: 'captureBaseline',
      monitorKey: 'M@0,0',
      rect: { x: 0, y: 0, width: 4, height: 4 },
    });
    expect(sent).toEqual([
      {
        id: 'q5',
        type: 'baselineCaptured',
        baselineId: 'b1',
        width: 4,
        height: 4,
        pngBase64: 'cGc=',
      },
    ]);
  });

  it('converts thrown errors into error responses carrying the id', async () => {
    const { ctx } = buildCtx();
    const { client, sent } = fakeClient();
    await handleMessage(ctx, client, {
      id: 'q6',
      type: 'captureBaseline',
      monitorKey: 'ghost',
      rect: { x: 0, y: 0, width: 4, height: 4 },
    });
    expect(sent[0]).toMatchObject({ id: 'q6', type: 'error' });
    expect((sent[0] as { message: string }).message).toContain('no such monitor');
  });

  it('routes preview subscriptions', async () => {
    const { ctx, calls } = buildCtx();
    const { client, sent } = fakeClient();
    await handleMessage(ctx, client, { id: 'q7', type: 'subscribePreview', monitorKey: 'M@0,0' });
    await handleMessage(ctx, client, { id: 'q8', type: 'unsubscribePreview', monitorKey: 'M@0,0' });
    expect(calls).toEqual(['subscribe:M@0,0', 'unsubscribe:M@0,0']);
    expect(sent).toEqual([
      { id: 'q7', type: 'ack' },
      { id: 'q8', type: 'ack' },
    ]);
  });

  it('testActions acks known regions and errors on unknown ones', async () => {
    const { ctx } = buildCtx([profile]);
    const { client, sent } = fakeClient();
    await handleMessage(ctx, client, {
      id: 'q9',
      type: 'testActions',
      profileId: 'p1',
      regionId: 'r1',
    });
    await handleMessage(ctx, client, {
      id: 'q10',
      type: 'testActions',
      profileId: 'p1',
      regionId: 'rX',
    });
    expect(sent[0]).toEqual({ id: 'q9', type: 'ack' });
    expect(sent[1]).toMatchObject({ id: 'q10', type: 'error' });
  });
});
