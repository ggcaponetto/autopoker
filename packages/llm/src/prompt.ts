import type { ModelMessage } from 'ai';
import { supportsPdfParts, supportsPromptCaching } from './providers';
import type { DecisionRequest, LoadedAttachment } from './types';

/** The subset of AI SDK user-content parts this prompt builder emits. */
type PromptPart = { providerOptions?: Record<string, unknown> } & (
  | { type: 'text'; text: string }
  | { type: 'file'; mediaType: string; data: Uint8Array; filename?: string }
);

export const SYSTEM_INSTRUCTIONS = `You are controlling a real computer by looking at screenshots of its screens.

You will be given: a strategy document written by the user, optional reference material, a list of named clickable regions ("landmarks") the user registered, a timestamped log of your own recent decisions, and one or more labelled screenshots (full monitors, or cropped views of the interesting area).

Your job is to decide what to do NEXT, following the strategy exactly. Rules:

- Base every decision on what is actually visible in the screenshots. Never assume state you cannot see.
- Use your decision log as the game history: it tells you what already happened this round. Entries marked "not executed" never happened on the machine — do not treat them as past actions.
- Prefer clicking a landmark by name ("clickRegion" with regionName) over raw coordinates: landmark clicks are precise, coordinate clicks are not.
- Only use "clickPoint" when no landmark covers the target. Coordinates are pixels of ONE screenshot exactly as shown to you, with (0,0) at its TOP-LEFT; set "monitorKey" to that screenshot's label.
- If it is not your turn to act, or the screen does not match anything the strategy covers, return a single {"type":"wait"} action. Waiting is always safe; guessing is not.
- Keep the action list short — the minimum needed for this one step.
- Set confidence honestly: below the configured threshold the action will not be executed.
- "observation" describes what you see (include concrete game state — cards, stacks, bets — it becomes your memory for the next turns); "reasoning" explains the choice against the strategy.`;

function attachmentIntro(loaded: LoadedAttachment): string {
  return `Reference material "${loaded.attachment.filename}" (${loaded.attachment.kind}):`;
}

/**
 * Turn one attachment into content parts. PDFs go through natively where the provider
 * supports it; elsewhere they fall back to text extracted by the caller.
 */
function attachmentParts(
  loaded: LoadedAttachment,
  canSendPdf: boolean,
  extractedPdfText: Map<string, string>,
): PromptPart[] {
  const { attachment, data } = loaded;
  const intro = attachmentIntro(loaded);

  if (attachment.kind === 'image') {
    return [
      { type: 'text', text: intro },
      { type: 'file', mediaType: attachment.mediaType, data },
    ];
  }
  if (attachment.kind === 'pdf') {
    if (canSendPdf) {
      return [
        { type: 'text', text: intro },
        {
          type: 'file',
          mediaType: 'application/pdf',
          data,
          filename: attachment.filename,
        },
      ];
    }
    const text = extractedPdfText.get(attachment.id) ?? '(PDF text could not be extracted)';
    return [{ type: 'text', text: `${intro}\n${text}` }];
  }
  return [{ type: 'text', text: `${intro}\n${new TextDecoder().decode(data)}` }];
}

function landmarkTable(request: DecisionRequest): string {
  if (request.landmarks.length === 0) {
    return 'No landmarks are registered. You must use clickPoint with coordinates.';
  }
  const rows = request.landmarks.map((landmark) => {
    const { x, y, width, height } = landmark.rect;
    const where = `monitor ${landmark.monitorKey}, rect x=${x} y=${y} w=${width} h=${height}`;
    return `- "${landmark.name}" — ${landmark.description || 'no description'} (${where})`;
  });
  return `Clickable landmarks (use these names with clickRegion):\n${rows.join('\n')}`;
}

function age(from: number, to: number): string {
  const seconds = Math.max(0, Math.round((to - from) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m${seconds % 60 ? ` ${seconds % 60}s` : ''} ago`;
}

function historyBlock(request: DecisionRequest): string | null {
  if (request.history.length === 0) return null;
  const rows = request.history.map((entry) => {
    const outcome = entry.executed ? entry.actionSummary : `${entry.actionSummary} (not executed)`;
    return `- [${age(entry.at, request.at)}] saw "${entry.observation}" -> ${outcome}`;
  });
  return `Your recent decisions, oldest first — this is the game history so far. Do not repeat an action that already took effect:\n${rows.join('\n')}`;
}

export interface BuildPromptOptions {
  /** Text extracted from PDFs, keyed by attachment id, for providers without PDF support. */
  extractedPdfText?: Map<string, string>;
}

/**
 * Assemble the message list. Static strategy content comes first and carries the Anthropic
 * cache breakpoint; the volatile screenshot goes last so the cached prefix stays stable
 * across ticks and repeated calls only pay for the new image.
 */
export function buildMessages(
  request: DecisionRequest,
  options: BuildPromptOptions = {},
): ModelMessage[] {
  const extractedPdfText = options.extractedPdfText ?? new Map<string, string>();
  const canSendPdf = supportsPdfParts(request.settings);
  const staticParts: PromptPart[] = [];

  if (request.context) {
    const { strategy, attachments } = request.context;
    const description = strategy.description ? `${strategy.description}\n\n` : '';
    const body = strategy.markdown || '(the user has not written the strategy yet)';
    staticParts.push({
      type: 'text',
      text: `# Strategy: ${strategy.name}\n\n${description}${body}`,
    });
    for (const loaded of attachments) {
      staticParts.push(...attachmentParts(loaded, canSendPdf, extractedPdfText));
    }
  } else {
    staticParts.push({
      type: 'text',
      text: 'No strategy document was provided. Act conservatively and prefer waiting.',
    });
  }

  const lastStatic = staticParts[staticParts.length - 1];
  if (supportsPromptCaching(request.settings) && lastStatic) {
    lastStatic.providerOptions = { anthropic: { cacheControl: { type: 'ephemeral' } } };
  }

  const volatileParts: PromptPart[] = [{ type: 'text', text: landmarkTable(request) }];
  const history = historyBlock(request);
  if (history) volatileParts.push({ type: 'text', text: history });
  if (request.triggeredRegionNames.length > 0) {
    const names = request.triggeredRegionNames.map((name) => `"${name}"`).join(', ');
    volatileParts.push({
      type: 'text',
      text: `These regions just changed and are why you were called: ${names}.`,
    });
  }

  for (const shot of request.screenshots) {
    const isCrop = shot.label !== shot.monitorKey;
    volatileParts.push({
      type: 'text',
      text: isCrop
        ? `Screenshot "${shot.label}" (${shot.captureWidth}x${shot.captureHeight} pixels) — a cropped view of the relevant screen area, captured just now. For clickPoint, give coordinates within THIS image and set monitorKey to "${shot.label}":`
        : `Screenshot "${shot.monitorKey}" (${shot.captureWidth}x${shot.captureHeight} pixels), captured just now:`,
    });
    volatileParts.push({ type: 'file', mediaType: shot.mediaType, data: shot.data });
  }
  volatileParts.push({
    type: 'text',
    text: 'Decide the next action now. Return only the structured decision.',
  });

  return [{ role: 'user', content: [...staticParts, ...volatileParts] }] as ModelMessage[];
}

export function summarizeActions(actions: { type: string; regionName?: string }[]): string {
  if (actions.length === 0) return 'nothing';
  return actions
    .map((action) => (action.regionName ? `${action.type}(${action.regionName})` : action.type))
    .join(' then ');
}
