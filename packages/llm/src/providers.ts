import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogle } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LlmSettings } from '@autopoker/shared';
import type { LanguageModel } from 'ai';
import { createOllama } from 'ai-sdk-ollama';

export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

export class MissingApiKeyError extends Error {
  constructor(readonly envVar: string) {
    super(
      `no API key: set the ${envVar} environment variable (autopoker never stores keys in profiles)`,
    );
    this.name = 'MissingApiKeyError';
  }
}

function requireApiKey(settings: LlmSettings, fallbackEnv: string): string {
  const envVar = settings.apiKeyEnv?.trim() || fallbackEnv;
  const key = process.env[envVar];
  if (!key) throw new MissingApiKeyError(envVar);
  return key;
}

/**
 * Build an AI SDK model for the configured provider. Every provider is created per call
 * so a settings change takes effect without restarting the daemon.
 */
export function resolveModel(settings: LlmSettings): LanguageModel {
  switch (settings.provider) {
    case 'ollama':
      return createOllama({ baseURL: settings.baseUrl || DEFAULT_OLLAMA_BASE_URL })(
        settings.model,
        // think:false suppresses the reasoning trace on thinking models (qwen3-vl,
        // deepseek-r1) — usually the biggest latency lever on local models. Only sent
        // when explicitly requested: some models reject the parameter outright.
        settings.thinking === 'off' ? { think: false } : {},
      );
    case 'anthropic':
      return createAnthropic({
        apiKey: requireApiKey(settings, 'ANTHROPIC_API_KEY'),
        ...(settings.baseUrl ? { baseURL: settings.baseUrl } : {}),
      })(settings.model);
    case 'openai':
      return createOpenAI({
        apiKey: requireApiKey(settings, 'OPENAI_API_KEY'),
        ...(settings.baseUrl ? { baseURL: settings.baseUrl } : {}),
      })(settings.model);
    case 'google':
      return createGoogle({
        apiKey: requireApiKey(settings, 'GOOGLE_GENERATIVE_AI_API_KEY'),
        ...(settings.baseUrl ? { baseURL: settings.baseUrl } : {}),
      })(settings.model);
    case 'openai-compatible': {
      if (!settings.baseUrl) throw new Error('openai-compatible requires a base URL');
      return createOpenAICompatible({
        name: 'openai-compatible',
        baseURL: settings.baseUrl,
        ...(settings.apiKeyEnv ? { apiKey: requireApiKey(settings, settings.apiKeyEnv) } : {}),
      })(settings.model);
    }
    case 'mock':
      throw new Error('the mock provider does not use a real model; use MockDecisionSource');
  }
}

/** True when the provider can accept PDFs as native file parts rather than extracted text. */
export function supportsPdfParts(settings: LlmSettings): boolean {
  return (
    settings.provider === 'anthropic' ||
    settings.provider === 'openai' ||
    settings.provider === 'google'
  );
}

/** True when the provider honours Anthropic-style cache_control breakpoints. */
export function supportsPromptCaching(settings: LlmSettings): boolean {
  return settings.provider === 'anthropic';
}
