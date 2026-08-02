import { createDefaultLlmSettings, type LlmSettings } from '@autopoker/shared';
import { describe, expect, it } from 'vitest';
import { buildMessages, summarizeActions } from './prompt';
import type { DecisionRequest, LoadedAttachment } from './types';

type Part = { type: string; text?: string; mediaType?: string; providerOptions?: unknown };

function partsOf(request: DecisionRequest): Part[] {
  const [message] = buildMessages(request);
  return (message as { content: Part[] }).content;
}

function textOf(request: DecisionRequest): string {
  return partsOf(request)
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

function makeRequest(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    settings: createDefaultLlmSettings(),
    context: {
      strategy: {
        id: 's1',
        name: 'Tight aggressive',
        description: 'Six-max cash game.',
        markdown: '# Preflop\n\nFold junk from early position.',
        attachments: [],
        updatedAt: 0,
      },
      attachments: [],
    },
    screenshots: [
      {
        monitorKey: 'M@0,0',
        mediaType: 'image/jpeg',
        data: new Uint8Array([1, 2, 3]),
        captureWidth: 1920,
        captureHeight: 1080,
      },
    ],
    landmarks: [
      {
        name: 'Fold button',
        description: 'bottom left of the table',
        monitorKey: 'M@0,0',
        rect: { x: 10, y: 20, width: 80, height: 30 },
      },
    ],
    history: [],
    triggeredRegionNames: [],
    ...overrides,
  };
}

function attachment(
  kind: 'image' | 'pdf' | 'text',
  mediaType: string,
  body: string,
): LoadedAttachment {
  return {
    attachment: {
      id: `a-${kind}`,
      filename: `ref.${kind}`,
      mediaType,
      kind,
      sizeBytes: body.length,
    },
    data: new TextEncoder().encode(body),
  };
}

describe('buildMessages', () => {
  it('puts the strategy first and the screenshot last', () => {
    const parts = partsOf(makeRequest());
    expect(parts[0]!.text).toContain('# Strategy: Tight aggressive');
    expect(parts[0]!.text).toContain('Fold junk from early position');
    expect(parts.at(-1)!.text).toContain('Decide the next action now');
    const fileParts = parts.filter((part) => part.type === 'file');
    expect(fileParts).toHaveLength(1);
    expect(fileParts[0]!.mediaType).toBe('image/jpeg');
  });

  it('lists landmarks with their rects so the model can click by name', () => {
    const text = textOf(makeRequest());
    expect(text).toContain('"Fold button"');
    expect(text).toContain('bottom left of the table');
    expect(text).toContain('x=10 y=20 w=80 h=30');
  });

  it('tells the model to use coordinates when there are no landmarks', () => {
    expect(textOf(makeRequest({ landmarks: [] }))).toContain('No landmarks are registered');
  });

  it('includes history and the regions that woke the model', () => {
    const text = textOf(
      makeRequest({
        history: [{ at: 1, observation: 'my turn', actionSummary: 'clickRegion(Fold button)' }],
        triggeredRegionNames: ['Turn indicator'],
      }),
    );
    expect(text).toContain('saw "my turn" -> did clickRegion(Fold button)');
    expect(text).toContain('"Turn indicator"');
  });

  it('handles a missing strategy without throwing', () => {
    expect(textOf(makeRequest({ context: null }))).toContain('No strategy document');
  });

  describe('attachments', () => {
    const anthropic: LlmSettings = {
      ...createDefaultLlmSettings(),
      provider: 'anthropic',
      model: 'claude-opus-5',
    };

    it('sends images as file parts', () => {
      const parts = partsOf(
        makeRequest({
          context: {
            strategy: {
              id: 's',
              name: 'S',
              description: '',
              markdown: 'x',
              attachments: [],
              updatedAt: 0,
            },
            attachments: [attachment('image', 'image/png', 'PNGDATA')],
          },
        }),
      );
      expect(parts.filter((part) => part.mediaType === 'image/png')).toHaveLength(1);
    });

    it('inlines text attachments', () => {
      const text = textOf(
        makeRequest({
          context: {
            strategy: {
              id: 's',
              name: 'S',
              description: '',
              markdown: 'x',
              attachments: [],
              updatedAt: 0,
            },
            attachments: [attachment('text', 'text/plain', 'RAISE MORE')],
          },
        }),
      );
      expect(text).toContain('RAISE MORE');
    });

    it('sends PDFs natively to providers that support them', () => {
      const parts = partsOf(
        makeRequest({
          settings: anthropic,
          context: {
            strategy: {
              id: 's',
              name: 'S',
              description: '',
              markdown: 'x',
              attachments: [],
              updatedAt: 0,
            },
            attachments: [attachment('pdf', 'application/pdf', '%PDF-1.7')],
          },
        }),
      );
      expect(parts.some((part) => part.mediaType === 'application/pdf')).toBe(true);
    });

    it('falls back to extracted text for providers without PDF support', () => {
      const request = makeRequest({
        context: {
          strategy: {
            id: 's',
            name: 'S',
            description: '',
            markdown: 'x',
            attachments: [],
            updatedAt: 0,
          },
          attachments: [attachment('pdf', 'application/pdf', '%PDF-1.7')],
        },
      });
      const [message] = buildMessages(request, {
        extractedPdfText: new Map([['a-pdf', 'range chart: open 15% UTG']]),
      });
      const parts = (message as { content: Part[] }).content;
      expect(parts.some((part) => part.mediaType === 'application/pdf')).toBe(false);
      expect(parts.map((part) => part.text).join('\n')).toContain('range chart: open 15% UTG');
    });
  });

  describe('prompt caching', () => {
    it('marks the last static part for Anthropic so the screenshot stays outside the cache', () => {
      const settings: LlmSettings = {
        ...createDefaultLlmSettings(),
        provider: 'anthropic',
        model: 'claude-opus-5',
      };
      const parts = partsOf(makeRequest({ settings }));
      const cached = parts.filter((part) => part.providerOptions !== undefined);
      expect(cached).toHaveLength(1);
      expect(cached[0]!.text).toContain('# Strategy');
      expect(cached[0]!.providerOptions).toEqual({
        anthropic: { cacheControl: { type: 'ephemeral' } },
      });
      // The screenshot must come after the breakpoint or the cache never hits.
      expect(parts.indexOf(cached[0]!)).toBeLessThan(
        parts.findIndex((part) => part.type === 'file'),
      );
    });

    it('does not set cache options for providers that ignore them', () => {
      const parts = partsOf(makeRequest());
      expect(parts.every((part) => part.providerOptions === undefined)).toBe(true);
    });
  });
});

describe('summarizeActions', () => {
  it('names the region when there is one', () => {
    expect(summarizeActions([{ type: 'clickRegion', regionName: 'Fold' }, { type: 'delay' }])).toBe(
      'clickRegion(Fold) then delay',
    );
  });

  it('handles an empty list', () => {
    expect(summarizeActions([])).toBe('nothing');
  });
});
