import {
  createDefaultLlmSettings,
  createDefaultSettings,
  ProfileSchema,
  StrategySchema,
  type EngineState,
  type Profile,
  type ServerMessage,
  type Strategy,
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

function buildCtx(initialProfiles: Profile[] = [], initialStrategies: Strategy[] = []) {
  const calls: string[] = [];
  const broadcasts: ServerMessage[] = [];
  const store = new Map(initialProfiles.map((entry) => [entry.id, entry]));
  const strategyStore = new Map(initialStrategies.map((entry) => [entry.id, entry]));
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
    strategies: {
      list: async () => [...strategyStore.values()],
      get: async (strategyId) => strategyStore.get(strategyId),
      save: async (strategy) => void strategyStore.set(strategy.id, strategy),
      delete: async (strategyId) => void strategyStore.delete(strategyId),
      addAttachment: async (strategyId, filename, mediaType, data) => {
        calls.push(`attach:${strategyId}:${filename}:${data.byteLength}`);
        return {
          id: 'att1',
          filename,
          mediaType,
          kind: mediaType === 'application/pdf' ? 'pdf' : 'text',
          sizeBytes: data.byteLength,
        };
      },
      deleteAttachment: async (strategyId, attachmentId) =>
        void calls.push(`detach:${strategyId}:${attachmentId}`),
    },
    listMonitors: async () => [],
    captureBaseline: async (monitorKey) => {
      if (monitorKey === 'ghost') throw new Error('no such monitor');
      return { baselineId: 'b1', width: 4, height: 4, pngBase64: 'cGc=' };
    },
    testActions: async (_profile, regionId) => regionId === 'r1',
    probeLlm: async (settings) => ({
      ok: settings.provider === 'mock',
      provider: settings.provider,
      message: `probed ${settings.provider}`,
      models: [],
    }),
    testDecision: async (profile) => void calls.push(`testDecision:${profile.id}`),
    broadcast: (message) => broadcasts.push(message),
  };
  return { ctx, calls, broadcasts, strategyStore };
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

  it('saveStrategy acks and broadcasts the new list', async () => {
    const { ctx, broadcasts } = buildCtx();
    const { client, sent } = fakeClient();
    const strategy = StrategySchema.parse({ id: 's1', name: 'Tight', markdown: '# Fold junk' });
    await handleMessage(ctx, client, { id: 'q1', type: 'saveStrategy', strategy });
    expect(sent).toEqual([{ id: 'q1', type: 'ack' }]);
    expect(broadcasts).toEqual([{ type: 'strategies', list: [strategy] }]);
  });

  it('lists and deletes strategies', async () => {
    const strategy = StrategySchema.parse({ id: 's1', name: 'Tight' });
    const { ctx, broadcasts } = buildCtx([], [strategy]);
    const { client, sent } = fakeClient();
    await handleMessage(ctx, client, { id: 'q2', type: 'listStrategies' });
    expect(sent[0]).toEqual({ id: 'q2', type: 'strategies', list: [strategy] });
    await handleMessage(ctx, client, { id: 'q3', type: 'deleteStrategy', strategyId: 's1' });
    expect(sent[1]).toEqual({ id: 'q3', type: 'ack' });
    expect(broadcasts.at(-1)).toEqual({ type: 'strategies', list: [] });
  });

  it('decodes base64 attachment uploads before storing them', async () => {
    const { ctx, calls } = buildCtx();
    const { client, sent } = fakeClient();
    await handleMessage(ctx, client, {
      id: 'q4',
      type: 'uploadAttachment',
      strategyId: 's1',
      filename: 'ranges.pdf',
      mediaType: 'application/pdf',
      dataBase64: Buffer.from('%PDF-1.7').toString('base64'),
    });
    expect(calls).toContain('attach:s1:ranges.pdf:8');
    expect(sent[0]).toMatchObject({
      id: 'q4',
      type: 'attachmentSaved',
      attachment: { filename: 'ranges.pdf', kind: 'pdf', sizeBytes: 8 },
    });
  });

  it('probes the configured provider', async () => {
    const { ctx } = buildCtx();
    const { client, sent } = fakeClient();
    await handleMessage(ctx, client, {
      id: 'q5',
      type: 'probeLlm',
      settings: { ...createDefaultLlmSettings(), provider: 'mock' },
    });
    expect(sent[0]).toMatchObject({ id: 'q5', type: 'llmProbe', result: { ok: true } });
  });

  it('testDecision runs against a known profile and rejects unknown ones', async () => {
    const { ctx, calls } = buildCtx([profile]);
    const { client, sent } = fakeClient();
    await handleMessage(ctx, client, { id: 'q6', type: 'testDecision', profileId: 'p1' });
    await handleMessage(ctx, client, { id: 'q7', type: 'testDecision', profileId: 'nope' });
    expect(calls).toContain('testDecision:p1');
    expect(sent[0]).toEqual({ id: 'q6', type: 'ack' });
    expect(sent[1]).toMatchObject({ id: 'q7', type: 'error' });
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
