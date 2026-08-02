# autopoker

Screen-automation robot for Windows: a local Node daemon captures every monitor on an
interval, watches user-registered screen regions for conditions (a button appearing, a
color change), and drives the mouse/keyboard when they fire. A browser UI handles region
registration, condition/action editing, and live monitoring.

The rule-based decision layer sits behind a `Decider` interface so a future LLM-driven
decider (screenshots in, actions out) can slot in without touching the engine, queue, or
executors.

## Quick start

```
npm install
npm run dev
```

- server: `ws://localhost:8787` (dry-run by default)
- UI: `http://localhost:5173`

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

## Packages

| workspace         | role                                                                                                                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/shared` | zod schemas for profiles/regions/conditions/actions + the WS protocol; browser-safe                                                                                                                                                                                            |
| `packages/core`   | engine: capture/input interfaces, condition evaluators, region state machine, action queue, coordinate mapper, stores; native adapters (`node-screenshots`, `@hurdlegroup/robotjs`, `uiohook-napi`) isolated behind `@autopoker/core/adapters` so tests never load native code |
| `apps/server`     | daemon: WS message router, engine controller, preview publisher; the only place adapters are instantiated                                                                                                                                                                      |
| `apps/ui`         | Vite + React: monitor previews, drag-to-register regions, region editor, engine controls, event log                                                                                                                                                                            |

Profiles live in `data/profiles/*.json`, baseline images in `data/baselines/*.png` (both
gitignored).

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
