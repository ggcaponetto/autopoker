import { LlmDecisionSchema } from '@autopoker/shared';
import { APICallError, generateText, NoObjectGeneratedError, Output, type LanguageModel } from 'ai';
import { extractPdfAttachments } from './pdf';
import { buildMessages, SYSTEM_INSTRUCTIONS } from './prompt';
import { resolveModel, supportsPdfParts } from './providers';
import type { DecisionRequest, DecisionResult, DecisionSource, DecisionUsage } from './types';

export class LlmDecisionError extends Error {
  constructor(
    message: string,
    readonly kind: 'invalid-output' | 'api' | 'unknown',
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LlmDecisionError';
  }
}

function classify(error: unknown): LlmDecisionError {
  if (NoObjectGeneratedError.isInstance(error)) {
    return new LlmDecisionError(
      `the model did not return a valid decision (${error.cause ? String(error.cause) : 'unparseable output'})`,
      'invalid-output',
      error,
    );
  }
  if (APICallError.isInstance(error)) {
    const status = error.statusCode ? ` (HTTP ${error.statusCode})` : '';
    return new LlmDecisionError(`the model call failed${status}: ${error.message}`, 'api', error);
  }
  return new LlmDecisionError(String(error), 'unknown', error);
}

/** Convert AI SDK usage into the flat shape the UI displays. */
function toUsage(usage: unknown): DecisionUsage | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const record = usage as {
    inputTokens?: number;
    outputTokens?: number;
    inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number };
  };
  const result: DecisionUsage = {
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    cacheReadTokens: record.inputTokenDetails?.cacheReadTokens,
    cacheWriteTokens: record.inputTokenDetails?.cacheWriteTokens,
  };
  return Object.values(result).some((value) => value !== undefined) ? result : undefined;
}

export interface AiSdkDecisionSourceOptions {
  /** Injectable for tests: bypasses provider resolution entirely. */
  modelFactory?: (request: DecisionRequest) => LanguageModel;
  now?: () => number;
}

/** Drives any AI SDK provider and returns a schema-validated decision. */
export class AiSdkDecisionSource implements DecisionSource {
  constructor(private readonly options: AiSdkDecisionSourceOptions = {}) {}

  async decide(request: DecisionRequest): Promise<DecisionResult> {
    const now = this.options.now ?? Date.now;
    const model = this.options.modelFactory
      ? this.options.modelFactory(request)
      : resolveModel(request.settings);

    const extractedPdfText =
      request.context && !supportsPdfParts(request.settings)
        ? await extractPdfAttachments(request.context.attachments)
        : undefined;

    const startedAt = now();
    try {
      const result = await generateText({
        model,
        instructions: SYSTEM_INSTRUCTIONS,
        messages: buildMessages(request, { extractedPdfText }),
        output: Output.object({
          schema: LlmDecisionSchema,
          name: 'ScreenDecision',
          description: 'What is on screen and which actions to take next.',
        }),
        maxOutputTokens: request.settings.maxOutputTokens,
        ...(request.settings.temperature === undefined
          ? {}
          : { temperature: request.settings.temperature }),
        abortSignal: request.signal ?? AbortSignal.timeout(request.settings.requestTimeoutMs),
      });

      return {
        decision: result.output,
        latencyMs: now() - startedAt,
        model: request.settings.model,
        usage: toUsage(result.usage),
      };
    } catch (error) {
      throw classify(error);
    }
  }
}
