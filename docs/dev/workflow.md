# Development workflow

## Running locally

| Command                      | What it does                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                | Daemon (`tsx watch`) + UI (Vite) with hot reload. The normal way to work.                                         |
| `npm run dev -w apps/server` | Just the daemon.                                                                                                  |
| `npm run dev -w apps/ui`     | Just the UI.                                                                                                      |
| `npm run docs:dev`           | This documentation site with hot reload (port 5174).                                                              |
| `npm run smoke`              | Manual native check: saves a screenshot per monitor and moves the mouse to each centre and back. Never run in CI. |

The daemon listens on `ws://localhost:8787`, the UI on `http://localhost:5173`, the docs dev server on `5174`.

## The quality gate

One command runs everything CI would:

```sh
npm run check
```

It runs, in order and failing fast:

1. **syncpack** — dependency versions are aligned across all workspaces.
2. **knip** — no dead code or unused dependencies.
3. **eslint** — lint across the repo.
4. **typecheck** — `tsc --noEmit` in every workspace.
5. **test** — the full Vitest suite.
6. **docs build** — VitePress builds the site, which **fails on dead links**. Broken internal links are caught here, not in production.

Everything that lands should pass `npm run check`. It's also what the pre-commit hook and (were it set up) CI would run.

## Testing

Tests are Vitest, colocated with source as `*.test.ts`, and organised as projects per package (`vitest.config.ts`). Run them with `npm test`, or a single project:

```sh
npx vitest run --project @autopoker/core
npx vitest run --project @autopoker/llm
```

The guiding principle: **no test touches native code, the network, or a real model.** This is possible because the engine is written against interfaces and the LLM layer behind `DecisionSource`.

| What's tested                 | How                                                                                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schemas & protocol (`shared`) | round-trip parse/serialize, defaults, rejection of bad input                                                                                             |
| Condition evaluators (`core`) | synthetic RGBA frames via a `makeFrame` helper                                                                                                           |
| The engine (`core`)           | fake timers + `FakeCapturer` + `RecordingExecutor`, covering debounce, cooldown, re-arm, dry-run, queue cap, failsafe, and LLM trigger/rate-limit gating |
| The LLM decider (`core`)      | a scripted `DecisionSource` fake — translation, region resolution, every safety gate, history                                                            |
| The AI SDK source (`llm`)     | the SDK's `MockLanguageModelV4` — schema round-trip, error classification                                                                                |
| Stores (`core`)               | round-trips against a temp directory                                                                                                                     |
| The message router (`server`) | `handleMessage` with injected fakes                                                                                                                      |

Out of scope for automated tests — real mouse movement, real capture, real models — is covered by the manual `smoke` script and the `data/e2e-*.mjs` scripts that drive a live daemon with the mock provider.

## Formatting and hooks

Prettier and ESLint are enforced. A pre-commit hook (simple-git-hooks + lint-staged) runs `eslint --fix` and `prettier --write` on staged files, so formatting is automatic on commit.

## Keeping the docs current

**Docs are part of the definition of done.** The project's `CLAUDE.md` requires that any change to behaviour, configuration, the protocol, or the schemas updates the relevant pages under `docs/` in the _same_ change. The docs build is in `npm run check`, so at minimum a broken link fails the gate — but the expectation is that the prose stays true to the code, not just that it links correctly.

When you change something, ask which of these it touches, and update the matching page:

| You changed…                             | Update…                                                                                                         |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| a schema / default / config field        | the relevant user-guide page **and** [Storage](./storage) if persistence changed                                |
| the engine loop, state machine, or queue | [The engine](./engine)                                                                                          |
| anything model-related                   | [The LLM pipeline](./llm), and [Model providers](/guide/providers) / [LLM mode](/guide/llm-mode) if user-facing |
| a protocol message                       | [WebSocket protocol](./protocol)                                                                                |
| a new provider / condition / action      | [Extending](./extending) and the matching user page                                                             |
| a safety mechanism                       | [Safety](/guide/safety)                                                                                         |

## Publishing the docs

`npm run docs:build` produces a static site in `docs/.vitepress/dist`. A GitHub Actions workflow (`.github/workflows/docs.yml`) builds and deploys it to GitHub Pages on every push to `main`. The `base` path is set via `DOCS_BASE` so the same build works locally (`/`) and under the project's Pages path (`/autopoker/`).
