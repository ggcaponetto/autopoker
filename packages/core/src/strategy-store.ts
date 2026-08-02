import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LoadedAttachment, StrategyContext } from '@autopoker/llm';
import {
  StrategySchema,
  type AttachmentKind,
  type Strategy,
  type StrategyAttachment,
} from '@autopoker/shared';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export function attachmentKindFor(mediaType: string): AttachmentKind {
  if (mediaType.startsWith('image/')) return 'image';
  if (mediaType === 'application/pdf') return 'pdf';
  return 'text';
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

/**
 * Stores strategies as a JSON manifest plus a real `strategy.md` file, so the user can
 * edit the markdown in their own editor and the daemon picks it up on next load.
 */
export class StrategyStore {
  constructor(private readonly dir: string) {}

  async list(): Promise<Strategy[]> {
    await mkdir(this.dir, { recursive: true });
    const entries = await readdir(this.dir, { withFileTypes: true });
    const strategies: Strategy[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const strategy = await this.get(entry.name);
      if (strategy) strategies.push(strategy);
    }
    return strategies.sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(strategyId: string): Promise<Strategy | undefined> {
    try {
      const raw = await readFile(path.join(this.folder(strategyId), 'strategy.json'), 'utf8');
      const manifest = StrategySchema.parse(JSON.parse(raw));
      // The markdown file is the source of truth; the manifest only carries metadata.
      const markdown = await readFile(this.markdownFile(strategyId), 'utf8').catch(() => '');
      return { ...manifest, markdown };
    } catch {
      return undefined;
    }
  }

  async save(strategy: Strategy): Promise<void> {
    const folder = this.folder(strategy.id);
    await mkdir(folder, { recursive: true });
    const { markdown, ...manifest } = { ...strategy, updatedAt: Date.now() };
    await writeFile(path.join(folder, 'strategy.json'), JSON.stringify(manifest, null, 2));
    await writeFile(this.markdownFile(strategy.id), markdown);
  }

  async delete(strategyId: string): Promise<void> {
    await rm(this.folder(strategyId), { recursive: true, force: true });
  }

  async addAttachment(
    strategyId: string,
    filename: string,
    mediaType: string,
    data: Uint8Array,
  ): Promise<StrategyAttachment> {
    if (data.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error(`attachment is larger than the ${MAX_ATTACHMENT_BYTES} byte limit`);
    }
    const strategy = await this.get(strategyId);
    if (!strategy) throw new Error(`strategy not found: ${strategyId}`);

    const attachment: StrategyAttachment = {
      id: `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      filename,
      mediaType,
      kind: attachmentKindFor(mediaType),
      sizeBytes: data.byteLength,
    };
    await mkdir(this.attachmentsFolder(strategyId), { recursive: true });
    await writeFile(this.attachmentFile(strategyId, attachment), data);
    await this.save({ ...strategy, attachments: [...strategy.attachments, attachment] });
    return attachment;
  }

  async deleteAttachment(strategyId: string, attachmentId: string): Promise<void> {
    const strategy = await this.get(strategyId);
    if (!strategy) return;
    const attachment = strategy.attachments.find((candidate) => candidate.id === attachmentId);
    if (!attachment) return;
    await rm(this.attachmentFile(strategyId, attachment), { force: true });
    await this.save({
      ...strategy,
      attachments: strategy.attachments.filter((candidate) => candidate.id !== attachmentId),
    });
  }

  /** Load a strategy with all attachment bytes, ready to hand to the LLM package. */
  async loadContext(strategyId: string): Promise<StrategyContext | null> {
    const strategy = await this.get(strategyId);
    if (!strategy) return null;
    const attachments: LoadedAttachment[] = [];
    for (const attachment of strategy.attachments) {
      try {
        const data = await readFile(this.attachmentFile(strategyId, attachment));
        attachments.push({ attachment, data: new Uint8Array(data) });
      } catch {
        // A missing file should not break the run; the model just sees less context.
      }
    }
    return { strategy, attachments };
  }

  private folder(strategyId: string): string {
    return path.join(this.dir, safeSegment(strategyId));
  }

  private markdownFile(strategyId: string): string {
    return path.join(this.folder(strategyId), 'strategy.md');
  }

  private attachmentsFolder(strategyId: string): string {
    return path.join(this.folder(strategyId), 'attachments');
  }

  private attachmentFile(strategyId: string, attachment: StrategyAttachment): string {
    return path.join(
      this.attachmentsFolder(strategyId),
      `${safeSegment(attachment.id)}__${safeSegment(attachment.filename)}`,
    );
  }
}
