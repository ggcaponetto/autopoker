import path from 'node:path';
import { BaselineStore, cropRgba, ProfileStore, StrategyStore } from '@autopoker/core';
import { NodeScreenshotsCapturer, RobotInputController } from '@autopoker/core/adapters';
import { probeLlm } from '@autopoker/llm';
import type { ServerMessage } from '@autopoker/shared';
import { EngineController } from './engine-controller';
import { handleMessage, type HandlerContext } from './handlers';
import { PreviewPublisher } from './preview';
import { safeDecode, startWsServer, type WsServerHandle } from './ws-server';

const SERVER_VERSION = '0.2.0';
const port = Number(process.env.PORT ?? 8787);
const repoRoot = path.resolve(import.meta.dirname, '../../..');
const dataDir = process.env.AUTOPOKER_DATA_DIR ?? path.join(repoRoot, 'data');

// Load API keys from a gitignored .env at the repo root, if the user made one.
try {
  process.loadEnvFile(path.join(repoRoot, '.env'));
  console.log('loaded .env');
} catch {
  // No .env is the normal case; keys can also come from the real environment.
}

let wsHandle: WsServerHandle | null = null;
const broadcast = (message: ServerMessage) => wsHandle?.broadcast(message);

const capturer = new NodeScreenshotsCapturer();
const input = new RobotInputController();
const baselines = new BaselineStore(path.join(dataDir, 'baselines'));
const profiles = new ProfileStore(path.join(dataDir, 'profiles'));
const strategies = new StrategyStore(path.join(dataDir, 'strategies'));
const controller = new EngineController(capturer, input, baselines, strategies, broadcast);
const preview = new PreviewPublisher(capturer, (message) =>
  broadcast({ type: 'log', level: 'warn', message, at: Date.now() }),
);

const ctx: HandlerContext = {
  engine: controller,
  profiles,
  strategies,
  preview,
  listMonitors: () => capturer.listMonitors(),
  captureBaseline: async (monitorKey, rect) => {
    const frame = await capturer.capture(monitorKey);
    const region = cropRgba(frame, rect);
    if (!region) throw new Error('rect is outside the monitor bounds');
    const baselineId = `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const png = await baselines.save(baselineId, region);
    return {
      baselineId,
      width: region.width,
      height: region.height,
      pngBase64: png.toString('base64'),
    };
  },
  testActions: (profile, regionId) => controller.testActions(profile, regionId),
  probeLlm: (settings) => probeLlm(settings),
  testDecision: (profile) => controller.testDecision(profile),
  broadcast,
};

wsHandle = startWsServer({
  port,
  onConnect: (client) =>
    client.send({ type: 'hello', serverVersion: SERVER_VERSION, engineState: controller.state() }),
  onDisconnect: (client) => preview.drop(client),
  onMessage: (client, raw) => {
    const message = safeDecode(client, raw);
    if (message) void handleMessage(ctx, client, message);
  },
});

console.log(`autopoker server listening on ws://localhost:${port}`);
console.log(`data directory: ${dataDir}`);
console.log('dry-run is the default; enable live mode explicitly from the UI');

process.on('SIGINT', () => {
  controller.stop();
  wsHandle?.close();
  process.exit(0);
});
