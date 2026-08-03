# Model providers

autopoker talks to models through the [Vercel AI SDK](https://ai-sdk.dev), so switching provider is just a dropdown in the **model** tab. Every setting below lives there.

## The providers

| Provider              | Needs                                              | Notes                                                                          |
| --------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Ollama** (default)  | Ollama running locally + a **vision** model pulled | Free, private, nothing leaves your machine.                                    |
| **Anthropic**         | `ANTHROPIC_API_KEY`                                | Highest accuracy. Static strategy context is prompt-cached automatically.      |
| **OpenAI**            | `OPENAI_API_KEY`                                   |                                                                                |
| **Google**            | `GOOGLE_GENERATIVE_AI_API_KEY`                     |                                                                                |
| **OpenAI-compatible** | a base URL                                         | For LM Studio, vLLM, OpenRouter, and anything else that speaks the OpenAI API. |
| **Mock**              | nothing                                            | Returns scripted decisions. For testing the loop with no model — see below.    |

::: danger The model must support vision
autopoker sends images. A text-only model cannot see the screen and will fail or hallucinate. When picking an Ollama model, choose a vision one (`llama3.2-vision`, `qwen2.5vl`, `minicpm-v`, `llava`, …).
:::

## API keys

**Keys are never stored in profiles.** autopoker only reads them from the environment. Two ways to provide one:

1. Set the environment variable before starting the daemon, or
2. Create a `.env` file at the repository root (it's gitignored) — the daemon loads it at startup:

```ini
# .env at the repo root
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_GENERATIVE_AI_API_KEY=...
```

The **API key env var** field in the UI lets you point a provider at a _different_ variable name if you keep several — but the value always comes from the environment, never from what you type into autopoker.

## Testing the connection

The **test connection** button probes the configured provider without spending a generation:

- For **Ollama**, it checks the server is reachable and lists the models you actually have installed — and warns if the model you named isn't among them, with the exact `ollama pull` command to fix it.
- For **cloud providers**, it verifies the configuration (chiefly that the API key is present) without a network call, so probing is free.

## Local models with Ollama

1. Install [Ollama](https://ollama.com).
2. Pull a vision model: `ollama pull llama3.2-vision`.
3. In the model tab, select **Ollama**, set the model name, and hit **test connection** — it should report the model installed.

The default base URL is `http://127.0.0.1:11434`. Override it in the **base URL** field if Ollama runs elsewhere.

::: tip Local models need help
Small local vision models are less precise than frontier cloud models. Lean on [landmarks](./llm-mode#landmarks-precision-without-trusting-the-model-s-aim) heavily, keep strategies short and explicit, and expect to raise `min confidence` cautiously. The **ask the model once** button is essential for seeing how a given local model actually behaves before trusting it.
:::

## OpenAI-compatible endpoints

Many local and hosted runtimes expose an OpenAI-style API — LM Studio, vLLM, OpenRouter, and others. Choose **OpenAI-compatible**, set the **base URL** to the endpoint, and if it needs a key, point **API key env var** at the environment variable holding it.

## The mock provider

The **Mock** provider returns scripted decisions instead of calling any model. It clicks the first landmark it's given (or waits if there are none). Use it to:

- see the entire capture → decide → translate → act loop working with no model installed and no API key,
- confirm your landmarks resolve to the right screen coordinates,
- demo the tool.

It's the recommended first thing to try in LLM mode.

## Prompt caching (Anthropic)

Your strategy — the markdown and attachments — is identical from one tick to the next; only the screenshot changes. With the Anthropic provider, autopoker automatically marks that static context for **prompt caching**, so repeated consultations only pay full price for the screenshot. The decision card in the model tab shows cached-token counts when caching is in effect. No configuration needed; it's on whenever you use Anthropic.
