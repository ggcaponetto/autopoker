# autopoker

Screen-automation robot for Windows: a local Node daemon captures every monitor on an
interval and drives the mouse/keyboard. It runs in one of two modes:

- **manual** — user-registered screen regions run their own action lists when a condition
  fires (a button appears, a color changes). No model involved.
- **llm** — the daemon sends screenshots to a vision model along with a strategy you wrote
  in markdown, and the model decides what to click.

Both modes share the same execution pipeline, so the safety machinery (dry-run, kill
switch, cooldowns, serial action queue) applies identically.

## Documentation

Full documentation lives in [`docs/`](./docs) (a VitePress site) — a **user guide** and a
**developer guide**. Run it locally with `npm run docs:dev`, or build the static site with
`npm run docs:build`. This README is a quick orientation; the docs are the depth.

- **New here?** [`docs/guide/getting-started`](./docs/guide/getting-started.md)
- **How it works?** [`docs/dev/`](./docs/dev/index.md)

## Quick start

```
npm install
npm run dev
```

- server: `ws://localhost:8787` (dry-run by default)
- UI: `http://localhost:5173`
- docs: `npm run docs:dev` → `http://localhost:5174`

Workflow: create a profile → drag a rectangle over a live monitor preview → pick a
condition (color at point · region average color · looks-like-baseline ·
changed-vs-baseline) → define action steps (move, click, type, key tap, delay) → save →
start the engine. Watch triggers in the event log under **dry-run** first; flip the LIVE
toggle only when the behavior looks right.

## Safety

- **Dry-run is the default.** Live mode is an explicit toggle with a red banner.
- While the engine runs, **Escape** (global hotkey, works from any app) halts it instantly.
- **Corner failsafe:** slam the mouse into the top-left corner of the primary monitor
  (0,0) to hard-stop; also checked before every action step.
- Triggers debounce (`confirmTicks`), rate-limit (`cooldownMs`), and re-arm policies
  prevent runaway clicking; the serial action queue never interleaves two sequences.

## LLM mode

Open the **model** tab in the sidebar, switch the profile to "LLM decides", pick a
provider and model, and select a strategy.

### Providers

| provider              | needs                                              | notes                                                        |
| --------------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| **Ollama** (default)  | Ollama running locally + a **vision** model pulled | free, private, no API key. `ollama pull llama3.2-vision`     |
| **Anthropic**         | `ANTHROPIC_API_KEY`                                | best accuracy; static context is prompt-cached automatically |
| **OpenAI**            | `OPENAI_API_KEY`                                   |                                                              |
| **Google**            | `GOOGLE_GENERATIVE_AI_API_KEY`                     |                                                              |
| **OpenAI-compatible** | a base URL                                         | LM Studio, vLLM, OpenRouter, …                               |
| **Mock**              | nothing                                            | scripted decisions — exercises the whole loop with no model  |

The model must support **vision**; a text-only model cannot see the screen. Switching
provider or model is a dropdown change — nothing else in the pipeline cares.

API keys are never written to profiles. Put them in the environment, or in a gitignored
`.env` at the repo root (`ANTHROPIC_API_KEY=sk-...`), which the daemon loads at startup.
The **test connection** button verifies reachability and, for Ollama, lists the models you
actually have installed.

### Strategies

A strategy is markdown you write in the **strategy** tab, plus optional attachments
(images, PDFs, text) — range charts, rules, annotated screenshots. All of it is sent to
the model as context, with the screenshot last. PDFs go to Anthropic/OpenAI/Google as
native file parts; for Ollama and other local models the text is extracted first.

Strategies live in `data/strategies/<id>/` as a real `strategy.md` file plus an
`attachments/` folder, so you can edit them in your own editor.

### Landmarks: how the model clicks accurately

Vision models are unreliable at raw pixel coordinates. Set a region's **purpose** to
`landmark` and give it a description ("the fold button, bottom left"), and the model can
click it _by name_ — autopoker resolves the name to the region's center and maps it to
screen coordinates. The model can still emit raw coordinates when no landmark fits.

So the manual region editor you use for testing is also what makes LLM mode precise.

### Controlling cost and risk

| control            | what it does                                                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **trigger**        | `onRegionTrigger` only calls the model once a cheap pixel rule fires (e.g. "it's my turn"); `everyTick` polls continuously and costs much more |
| **min gap ms**     | hard floor between model calls — the main cost control                                                                                         |
| **min confidence** | decisions below this are shown but never executed                                                                                              |
| **max actions**    | a decision with more actions than this is rejected outright                                                                                    |
| **dry-run**        | the model is still asked and its decision displayed; nothing is clicked                                                                        |

Translation is all-or-nothing: if the model names a region that doesn't exist, the whole
decision is rejected rather than half-executed. Only one model call is ever in flight —
the engine awaits it inside the tick, so a slow model slows the loop instead of stacking
up concurrent calls.

### Tuning loop

Use **ask the model once** in the model tab: it captures a screenshot, asks the model, and
shows the observation, reasoning, confidence, and the exact steps the decision translated
into — without acting. Iterate on the strategy markdown until the decisions look right,
then start the engine in dry-run, then go live.

## Packages

| workspace         | role                                                                                                                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/shared` | zod schemas for profiles/regions/conditions/actions/strategies/LLM settings + the WS protocol; browser-safe                                                                                                                                                                    |
| `packages/llm`    | provider registry (Ollama/Anthropic/OpenAI/Google/openai-compatible/mock), prompt assembly, PDF text extraction, and the schema-validated decision call via the Vercel AI SDK                                                                                                  |
| `packages/core`   | engine: capture/input interfaces, condition evaluators, region state machine, action queue, coordinate mapper, stores; native adapters (`node-screenshots`, `@hurdlegroup/robotjs`, `uiohook-napi`) isolated behind `@autopoker/core/adapters` so tests never load native code |
| `apps/server`     | daemon: WS message router, engine controller, preview publisher; the only place adapters are instantiated                                                                                                                                                                      |
| `apps/ui`         | Vite + React: monitor previews, drag-to-register regions, region editor, engine controls, event log                                                                                                                                                                            |

Profiles live in `data/profiles/*.json`, baseline images in `data/baselines/*.png`, and
strategies in `data/strategies/<id>/` (all gitignored).

The engine talks to models only through a `DecisionSource` interface, and `core` imports
that interface with `import type`, so no AI SDK code is ever loaded during tests or in
manual mode.

## Commands

| command                     | what                                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`               | server + UI with hot reload                                                                                                                     |
| `npm run check`             | syncpack + knip + eslint + typecheck + vitest, the single quality gate                                                                          |
| `npm run test`              | vitest across all workspaces                                                                                                                    |
| `npm run smoke`             | manual native smoke test: saves a JPEG of each monitor to `data/smoke/`, moves the mouse to each monitor center and back with position readback |
| `npm run smoke -- --listen` | same, then listens 10 s for Escape to verify the global kill-switch hook                                                                        |

## Manual verification of live mode

1. Open Notepad; drag a region over a UI element; condition `changed vs baseline` with a
   freshly captured baseline; action `click`.
2. Start in dry-run; confirm triggers appear in the event log exactly when expected.
3. Toggle LIVE; confirm one click per trigger, the cooldown holds, and Escape halts
   immediately.

## Notes

- Node >= 24. Every native dependency ships prebuilt binaries — no Visual Studio Build
  Tools required.
- Monitor keys are `name@x,y` because Windows monitor names are not unique.
- Region rects are stored in capture (physical) pixels per monitor; the
  `ScaledCoordinateMapper` converts to virtual-screen coordinates at execution time,
  including scale factors on high-DPI monitors.
