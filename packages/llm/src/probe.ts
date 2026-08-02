import type { LlmProbeResult, LlmSettings } from '@autopoker/shared';
import { DEFAULT_OLLAMA_BASE_URL, MissingApiKeyError, resolveModel } from './providers';

interface OllamaTagsResponse {
  models?: { name?: string }[];
}

/**
 * Check that the configured provider is reachable and usable, without spending a
 * generation. For Ollama this also returns the locally installed model list.
 */
export async function probeLlm(settings: LlmSettings): Promise<LlmProbeResult> {
  if (settings.provider === 'mock') {
    return { ok: true, provider: 'mock', message: 'mock provider needs no connection', models: [] };
  }

  if (settings.provider === 'ollama') {
    const baseUrl = (settings.baseUrl || DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, '');
    try {
      const response = await fetch(`${baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        return {
          ok: false,
          provider: 'ollama',
          message: `Ollama replied HTTP ${response.status} at ${baseUrl}`,
          models: [],
        };
      }
      const body = (await response.json()) as OllamaTagsResponse;
      const models = (body.models ?? [])
        .map((model) => model.name)
        .filter((name): name is string => Boolean(name));
      const installed = models.includes(settings.model);
      return {
        ok: installed,
        provider: 'ollama',
        message: installed
          ? `Ollama is reachable and "${settings.model}" is installed`
          : `Ollama is reachable but "${settings.model}" is not installed — run: ollama pull ${settings.model}`,
        models,
      };
    } catch (error) {
      return {
        ok: false,
        provider: 'ollama',
        message: `cannot reach Ollama at ${baseUrl}: ${String(error)}`,
        models: [],
      };
    }
  }

  // Cloud providers: verify configuration (chiefly the API key) without a network call,
  // so probing costs nothing.
  try {
    resolveModel(settings);
    return {
      ok: true,
      provider: settings.provider,
      message: `configured: ${settings.provider} / ${settings.model}`,
      models: [],
    };
  } catch (error) {
    const message =
      error instanceof MissingApiKeyError
        ? error.message
        : `cannot configure ${settings.provider}: ${String(error)}`;
    return { ok: false, provider: settings.provider, message, models: [] };
  }
}
