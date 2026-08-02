/**
 * Manual smoke test for the native automation stack, driven through the same core
 * adapters the daemon uses. Never run in CI.
 *
 *   npm run smoke              capture monitors, verify mouse move/readback, restore cursor
 *   npm run smoke -- --listen  additionally listen 10 s for the Escape key via uiohook
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  NodeScreenshotsCapturer,
  RobotInputController,
  startKillSwitch,
} from '@autopoker/core/adapters';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const outDir = path.resolve(import.meta.dirname, '../../../data/smoke');
  await mkdir(outDir, { recursive: true });

  const capturer = new NodeScreenshotsCapturer();
  const input = new RobotInputController();

  const monitors = await capturer.listMonitors();
  for (const monitor of monitors) {
    const jpeg = await capturer.captureJpeg(monitor.key);
    const file = path.join(outDir, `${monitor.key.replace(/[^a-z0-9@,-]/gi, '_')}.jpg`);
    await writeFile(file, jpeg);
    console.log(
      `monitor ${monitor.key}: logical ${monitor.width}x${monitor.height} at (${monitor.x},${monitor.y})` +
        ` scale=${monitor.scaleFactor} capture=${monitor.captureWidth}x${monitor.captureHeight}` +
        ` primary=${monitor.isPrimary} -> ${file}`,
    );
  }

  const original = input.getMousePos();
  for (const monitor of monitors) {
    const target = {
      x: monitor.x + Math.floor(monitor.width / 2),
      y: monitor.y + Math.floor(monitor.height / 2),
    };
    input.moveMouse(target);
    await sleep(50);
    const got = input.getMousePos();
    const ok = Math.abs(got.x - target.x) <= 1 && Math.abs(got.y - target.y) <= 1;
    console.log(
      `moveMouse(${target.x},${target.y}) on ${monitor.key} -> readback (${got.x},${got.y}) ${ok ? 'OK' : 'MISMATCH'}`,
    );
  }
  input.moveMouse(original);
  console.log('cursor restored to', input.getMousePos());

  if (process.argv.includes('--listen')) {
    console.log('listening for Escape for 10 seconds — press it now...');
    const killSwitch = startKillSwitch('Escape', () => console.log('Escape detected via uiohook'));
    await sleep(10_000);
    killSwitch.stop();
    console.log('listener stopped');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
