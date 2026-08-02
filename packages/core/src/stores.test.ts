import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDefaultSettings, ProfileSchema, type Profile } from '@autopoker/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaselineStore } from './baselines';
import { ProfileStore } from './config-store';
import { makeFrame } from './testing';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'autopoker-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function sampleProfile(id: string, name: string): Profile {
  return ProfileSchema.parse({
    id,
    name,
    regions: [],
    settings: createDefaultSettings(),
  });
}

describe('ProfileStore', () => {
  it('round-trips profiles through disk', async () => {
    const store = new ProfileStore(dir);
    await store.save(sampleProfile('p1', 'Bravo'));
    await store.save(sampleProfile('p2', 'Alpha'));
    const listed = await store.list();
    expect(listed.map((profile) => profile.name)).toEqual(['Alpha', 'Bravo']);
    expect(await store.get('p1')).toMatchObject({ id: 'p1', name: 'Bravo' });
  });

  it('skips invalid files instead of failing', async () => {
    const store = new ProfileStore(dir);
    await store.save(sampleProfile('p1', 'Valid'));
    await writeFile(path.join(dir, 'broken.json'), '{not json');
    await writeFile(path.join(dir, 'wrong.json'), JSON.stringify({ id: 'x' }));
    expect(await store.list()).toHaveLength(1);
  });

  it('deletes profiles', async () => {
    const store = new ProfileStore(dir);
    await store.save(sampleProfile('p1', 'Doomed'));
    await store.delete('p1');
    expect(await store.list()).toHaveLength(0);
    expect(await store.get('p1')).toBeUndefined();
  });
});

describe('BaselineStore', () => {
  const frame = makeFrame(6, 4, (x, y) => ({ r: x * 40, g: y * 60, b: 7 }));

  it('round-trips frames through PNG files', async () => {
    await new BaselineStore(dir).save('b1', frame);
    const fresh = new BaselineStore(dir);
    expect(fresh.get('b1')).toBeUndefined();
    const loaded = await fresh.load('b1');
    expect(loaded).toBeDefined();
    expect(loaded!.width).toBe(6);
    expect(loaded!.height).toBe(4);
    expect(Array.from(loaded!.rgba)).toEqual(Array.from(frame.rgba));
    expect(fresh.get('b1')).toBe(loaded);
  });

  it('returns undefined for missing baselines', async () => {
    expect(await new BaselineStore(dir).load('nope')).toBeUndefined();
  });
});
