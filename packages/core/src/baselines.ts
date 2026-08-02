import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import type { BaselineProvider, Frame } from './types';

/** Persists region baseline images as PNGs and serves them as raw frames from memory. */
export class BaselineStore implements BaselineProvider {
  private readonly cache = new Map<string, Frame>();

  constructor(private readonly dir: string) {}

  get(baselineId: string): Frame | undefined {
    return this.cache.get(baselineId);
  }

  /** Load a baseline PNG from disk into the cache. Returns undefined when missing/corrupt. */
  async load(baselineId: string): Promise<Frame | undefined> {
    const cached = this.cache.get(baselineId);
    if (cached) return cached;
    try {
      const png = PNG.sync.read(await readFile(this.file(baselineId)));
      const frame: Frame = { width: png.width, height: png.height, rgba: png.data };
      this.cache.set(baselineId, frame);
      return frame;
    } catch {
      return undefined;
    }
  }

  async loadAll(baselineIds: Iterable<string>): Promise<void> {
    for (const id of baselineIds) await this.load(id);
  }

  /** Persist a frame as the baseline's PNG and cache it. Returns the encoded PNG. */
  async save(baselineId: string, frame: Frame): Promise<Buffer> {
    const png = new PNG({ width: frame.width, height: frame.height });
    png.data = Buffer.from(frame.rgba);
    const encoded = PNG.sync.write(png);
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file(baselineId), encoded);
    this.cache.set(baselineId, frame);
    return encoded;
  }

  private file(baselineId: string): string {
    return path.join(this.dir, `${baselineId.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`);
  }
}
