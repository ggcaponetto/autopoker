import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { StrategySchema } from '@autopoker/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attachmentKindFor, MAX_ATTACHMENT_BYTES, StrategyStore } from './strategy-store';

let dir: string;
let store: StrategyStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'autopoker-strategy-'));
  store = new StrategyStore(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const sample = StrategySchema.parse({
  id: 's1',
  name: 'Tight aggressive',
  description: 'Six-max cash',
  markdown: '# Preflop\n\nFold junk from early position.',
});

describe('attachmentKindFor', () => {
  it('maps media types to kinds', () => {
    expect(attachmentKindFor('image/png')).toBe('image');
    expect(attachmentKindFor('application/pdf')).toBe('pdf');
    expect(attachmentKindFor('text/markdown')).toBe('text');
  });
});

describe('StrategyStore', () => {
  it('round-trips a strategy and lists it', async () => {
    await store.save(sample);
    const loaded = await store.get('s1');
    expect(loaded).toMatchObject({ id: 's1', name: 'Tight aggressive', markdown: sample.markdown });
    expect((await store.list()).map((strategy) => strategy.id)).toEqual(['s1']);
  });

  it('writes the markdown as a real .md file the user can edit', async () => {
    await store.save(sample);
    const onDisk = await readFile(path.join(dir, 's1', 'strategy.md'), 'utf8');
    expect(onDisk).toBe(sample.markdown);
  });

  it('reads edits made to the markdown file outside the app', async () => {
    await store.save(sample);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(dir, 's1', 'strategy.md'), '# Edited by hand');
    expect((await store.get('s1'))?.markdown).toBe('# Edited by hand');
  });

  it('stamps updatedAt on save', async () => {
    await store.save(sample);
    expect((await store.get('s1'))!.updatedAt).toBeGreaterThan(0);
  });

  it('returns undefined for unknown strategies and ignores stray files', async () => {
    expect(await store.get('nope')).toBeUndefined();
    expect(await store.list()).toEqual([]);
  });

  it('deletes a strategy and its folder', async () => {
    await store.save(sample);
    await store.delete('s1');
    expect(await store.get('s1')).toBeUndefined();
    expect(await store.list()).toEqual([]);
  });

  describe('attachments', () => {
    it('stores bytes and records metadata', async () => {
      await store.save(sample);
      const data = new TextEncoder().encode('%PDF-1.7 fake');
      const attachment = await store.addAttachment('s1', 'ranges.pdf', 'application/pdf', data);
      expect(attachment).toMatchObject({ filename: 'ranges.pdf', kind: 'pdf', sizeBytes: 13 });
      expect((await store.get('s1'))!.attachments).toHaveLength(1);
    });

    it('loads attachment bytes back as an LLM context', async () => {
      await store.save(sample);
      const data = new TextEncoder().encode('open 15% UTG');
      await store.addAttachment('s1', 'notes.txt', 'text/plain', data);
      const context = await store.loadContext('s1');
      expect(context!.strategy.name).toBe('Tight aggressive');
      expect(context!.attachments).toHaveLength(1);
      expect(new TextDecoder().decode(context!.attachments[0]!.data)).toBe('open 15% UTG');
    });

    it('removes an attachment from disk and from the manifest', async () => {
      await store.save(sample);
      const attachment = await store.addAttachment(
        's1',
        'notes.txt',
        'text/plain',
        new TextEncoder().encode('x'),
      );
      await store.deleteAttachment('s1', attachment.id);
      expect((await store.get('s1'))!.attachments).toEqual([]);
      expect((await store.loadContext('s1'))!.attachments).toEqual([]);
    });

    it('rejects attachments over the size limit', async () => {
      await store.save(sample);
      const tooBig = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
      await expect(store.addAttachment('s1', 'huge.bin', 'text/plain', tooBig)).rejects.toThrow(
        /larger than/,
      );
    });

    it('rejects attachments for unknown strategies', async () => {
      await expect(
        store.addAttachment('ghost', 'x.txt', 'text/plain', new Uint8Array(1)),
      ).rejects.toThrow(/not found/);
    });

    it('strips path separators so an attachment cannot escape its folder', async () => {
      await store.save(sample);
      await store.addAttachment(
        's1',
        '../../escape.txt',
        'text/plain',
        new TextEncoder().encode('nope'),
      );
      const { readdir } = await import('node:fs/promises');
      const attachmentsDir = path.join(dir, 's1', 'attachments');
      const files = await readdir(attachmentsDir);
      expect(files).toHaveLength(1);
      // Separators are what make traversal possible; dots alone are an ordinary filename.
      expect(files[0]).not.toMatch(/[/\\]/);
      expect(path.resolve(attachmentsDir, files[0]!).startsWith(path.resolve(attachmentsDir))).toBe(
        true,
      );
      expect(await readdir(dir)).toEqual(['s1']);
    });
  });

  it('returns null context for a missing strategy', async () => {
    expect(await store.loadContext('nope')).toBeNull();
  });
});
