# The LLM pipeline

Everything model-related lives in `packages/llm`, behind a single interface the engine depends on. This page traces a decision from tick to executed step.

## The seam: `DecisionSource`

`packages/core` depends on `packages/llm` **only through `import type`**. The one runtime contract is:

```ts
interface DecisionSource {
  decide(request: DecisionRequest): Promise<DecisionResult>;
}
```

A `DecisionRequest` carries the resolved settings, the strategy context (markdown + attachment bytes), the screenshots, the landmarks, recent history, and the names of regions that just triggered. A `DecisionResult` carries the validated `LlmDecision`, latency, model id, and token usage.

This seam is why an LLM decider can slot into the engine without the engine knowing anything about the AI SDK, and why the whole thing is testable with a mock.

## The two sides

```mermaid
flowchart LR
  subgraph core[packages/core]
    dec[LlmDecider]
  end
  subgraph llm[packages/llm]
    src[AiSdkDecisionSource]
    mock[MockDecisionSource]
    prompt[prompt builder]
    prov[provider registry]
  end
  dec -->|DecisionRequest| src
  dec -->|DecisionRequest| mock
  src --> prompt
  src --> prov
  prov -->|Vercel AI SDK| model[(Vision model)]
```

- **`LlmDecider`** (in `core`) orchestrates: it builds the request, calls the source, translates the answer into engine actions, and enforces safety limits.
- **`AiSdkDecisionSource`** (in `llm`) does the model call: assembles the prompt, resolves the provider, and validates the structured response.
- **`MockDecisionSource`** returns scripted decisions with no model — used for tests and the UI's mock provider.

The server routes `mock` provider requests to the mock source and everything else to the real one (`RoutingDecisionSource` in `engine-controller.ts`).

## Provider registry

`resolveModel(settings)` builds a Vercel AI SDK `LanguageModel` for the configured provider — Ollama, Anthropic, OpenAI, Google, or an OpenAI-compatible endpoint. Providers are constructed **per call**, so a settings change takes effect without restarting the daemon. API keys are read from `process.env` (never from stored config) via the provider's default variable or a `apiKeyEnv` override.

Two capability predicates drive prompt assembly:

- `supportsPdfParts(settings)` — Anthropic, OpenAI, Google accept native PDF parts; others get extracted text.
- `supportsPromptCaching(settings)` — only Anthropic honours `cache_control`.

## Prompt assembly

`buildMessages()` constructs the message list with a deliberate ordering:

1. **Static context first** — the strategy markdown and attachments. Identical every tick.
2. **Volatile context last** — the landmark table, recent history, what-just-triggered, and finally the screenshots.

With Anthropic, the last static part is marked with `cache_control: { type: 'ephemeral' }`, so the unchanging strategy prefix is cached and repeated ticks only pay for the screenshot. Ordering is what makes caching effective — the cached prefix must be byte-stable, so anything that changes goes after the breakpoint.

Attachments are turned into content parts by kind: images as file parts, text inlined, PDFs either as native file parts or (for providers without PDF support) as text extracted by `unpdf`.

## Structured output

The model is asked for a decision matching `LlmDecisionSchema` via the AI SDK's `generateText` with `Output.object({ schema })`. The schema is a **flat action shape** — a single object with optional fields, not a discriminated union — because small local vision models produce it far more reliably. Translating that flat shape into the strict engine `ActionStep` union happens in code, where a mismatch yields a clear message instead of a schema rejection.

Errors are classified into `invalid-output` (the model returned something unparseable or schema-violating) versus `api` (a network/HTTP failure), so the decider can react appropriately.

## Translation: flat actions → engine steps

`LlmDecider.translate()` converts the model's actions into `ActionStep`s with real screen coordinates. It's **all-or-nothing**: if any action fails to resolve, the whole decision is rejected. The rationale is safety — half of a plan ("click Raise, type 100, press Enter") is more dangerous than none.

| Model action               | Resolves to                                                                                                 | Fails if                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `clickRegion`              | click at the named landmark's centre (name matched case/whitespace-insensitively) → mapped to screen coords | the name matches no region         |
| `clickPoint` / `moveMouse` | click/move at given coords on a monitor → mapped                                                            | no coordinates, or unknown monitor |
| `typeText`                 | type the string                                                                                             | no text                            |
| `keyTap`                   | press key + modifiers                                                                                       | no key                             |
| `delay`                    | wait (clamped to 0–60000ms)                                                                                 | —                                  |
| `wait`                     | filtered out before translation (produces no step)                                                          | —                                  |

## Safety gating in the decider

Before returning any steps, `LlmDecider` applies, in order:

1. **confidence** — below `minConfidence`, the decision is recorded but not executed.
2. **action cap** — more than `maxActionsPerDecision` actions → rejected whole.
3. **translation** — any unresolved action → rejected whole.
4. **dry-run** — even a valid, confident, fully-translated decision produces a record marked "not executed" and returns nothing to the engine.

Every outcome — executed or skipped, with the reason — is emitted as an `LlmDecisionRecord` so the UI can display and audit it. History (for continuity across turns) accumulates **only for decisions that actually executed**, so the model is never reminded of an action that didn't happen.

## The probe

`probeLlm(settings)` checks a provider without spending a generation. For Ollama it hits `/api/tags` and returns the installed model list (and whether the requested model is among them). For cloud providers it verifies configuration — chiefly that the API key resolves — with no network call. This powers the UI's **test connection** button.

## Testing without a network

`packages/llm` tests use the AI SDK's `MockLanguageModelV4` to drive `AiSdkDecisionSource` end-to-end — asserting the schema round-trips, that invalid output is classified correctly, and that temperature is only sent when configured. `core`'s `LlmDecider` tests use a scripted `DecisionSource` fake to cover translation, region resolution, all the safety gates, dry-run behaviour, and history. No test touches a real model.
