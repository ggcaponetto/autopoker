# Extending autopoker

The codebase is built around a few small interfaces, so most extensions are localized. This page is a recipe book for the common ones. Every change should come with tests and updated docs — see [Development workflow](./workflow).

## Add a model provider

Providers live in `packages/llm/src/providers.ts`.

1. Add the provider name to `LlmProviderSchema` in `packages/shared/src/llm.ts`.
2. Add a branch to `resolveModel()` that constructs the AI SDK model — mirror an existing case. Read any key via `requireApiKey(settings, 'ENV_VAR')`.
3. If it accepts native PDF parts, add it to `supportsPdfParts()`; if it honours Anthropic-style cache breakpoints, to `supportsPromptCaching()`.
4. Add it to the `PROVIDERS` and `MODEL_SUGGESTIONS` lists in `apps/ui/src/components/ModelPanel.tsx` so it appears in the dropdown.
5. If it needs a bespoke connection check, extend `probeLlm()` in `probe.ts`; otherwise the default config-verification path covers it.

The engine, decider, and prompt builder need no changes — they only see the resolved `LanguageModel`.

## Add a condition type

Conditions are evaluated in `packages/core/src/conditions.ts`.

1. Add the variant to `ConditionSchema` (a discriminated union) in `packages/shared/src/config.ts`.
2. Add a `case` to `evaluateCondition()` returning `{ matched, value? }`. Region pixels arrive as a cropped RGBA `Frame`; helpers for colour-at-point, average colour, and baseline diffing are alongside.
3. Add the editor UI for its fields in `apps/ui/src/components/RegionEditor.tsx`.
4. Add a test in `conditions.test.ts` using the `makeFrame` helper to paint synthetic pixels.

## Add an action step

Actions are the vocabulary of both manual sequences and LLM decisions.

1. Add the step to `ActionStepSchema` in `packages/shared/src/actions.ts`.
2. Handle it in `StepActionExecutor.execute()` (`packages/core/src/executor.ts`), driving it through the `InputController` interface.
3. If the LLM should be able to emit it, add a corresponding field to `LlmActionSchema` (`llm.ts`) and a translation branch in `LlmDecider.translateAction()` (`llm-decider.ts`).
4. Add the step's controls to the action builder in `RegionEditor.tsx`.
5. Test the executor branch (`executor.test.ts`) and, if applicable, the translation (`llm-decider.test.ts`).

## Add a decision source (e.g. a different model backend)

If you want a wholly different way to produce decisions — not just a new AI SDK provider — implement `DecisionSource` from `packages/llm`:

```ts
class MyDecisionSource implements DecisionSource {
  async decide(request: DecisionRequest): Promise<DecisionResult> {
    // return a validated LlmDecision, latency, model id, usage
  }
}
```

Wire it into `RoutingDecisionSource` in `apps/server/src/engine-controller.ts`. The engine and `LlmDecider` are unaffected — they only know the interface. This is also how you'd add, say, a rules-plus-model hybrid.

## Add a protocol message

1. Add the variant to `ClientMessageSchema` or `ServerMessageSchema` in `packages/shared/src/protocol.ts`.
2. Handle it in `handleMessage()` in `apps/server/src/handlers.ts` (client→server) or reduce it in `apps/ui/src/ws/useServer.ts` (server→client).
3. TypeScript exhaustiveness will point you at every switch that needs the new case.
4. Extend `handlers.test.ts` for a client→server message.

See [the protocol reference](./protocol) for the full catalogue.

## Swap a native adapter

The engine is written against `ScreenCapturer`, `InputController`, and `CoordinateMapper`. To swap a native library (say, a different capture backend), implement the relevant interface in `packages/core/src/adapters/` and construct it in `apps/server/src/engine-controller.ts` / `main.ts`. Nothing else changes, and the engine's own tests keep using fakes.

## The rule of thumb

If your change touches how data is shaped, it starts in `packages/shared` (the schema is the contract). If it touches behaviour, it lives in `core` or `llm` behind an existing interface. If it touches native code, it's confined to `core/adapters`. The UI and server are the assembly layer. Keeping to those boundaries is what keeps the test suite fast and the engine portable.
