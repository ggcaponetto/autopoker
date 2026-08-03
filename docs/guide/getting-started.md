# Getting started

## Prerequisites

- **Windows 11** (the native capture and input libraries target Windows).
- **Node.js 24 or newer.** Check with `node --version`.
- That's it. Every native dependency ships prebuilt binaries — you do **not** need Visual Studio Build Tools or Python.

## Install and run

From the repository root:

```sh
npm install
npm run dev
```

`npm run dev` starts two things at once:

- the **daemon** on `ws://localhost:8787` (dry-run by default),
- the **UI** on `http://localhost:5173`.

Open <http://localhost:5173> in a browser. Within a second or two you should see a green **connected** pill in the top bar and a live preview of each monitor.

::: tip Nothing appears?
If the pill says **disconnected**, the daemon side didn't start — check that terminal. An `EADDRINUSE: 8787` there means a stray process is holding the port. See [Troubleshooting](./troubleshooting#the-ui-says-disconnected).
:::

## Your first automation (manual mode, dry-run)

This walks through the safe end-to-end loop without touching anything important. Open **Notepad** (or any window with a clickable button) on your primary monitor.

1. **Register a region.** In the UI, drag a rectangle over a button in the preview. A region editor opens on the right, and a "Default" profile is created for you.
2. **Give it a condition.** The default condition is _color at point_. Leave it — you just want to see a trigger fire.
3. **Give it an action.** The default action is a left click at the region's center. Leave it too.
4. **Save the region.**
5. **Start the engine** with the ▶ button in the top bar. It starts in **dry-run**, meaning the mouse never actually moves.
6. **Watch the event log.** When the condition matches, you'll see a `triggered` entry showing exactly what _would_ have happened.

That is the whole loop: capture → evaluate → (would-)act. Nothing clicked, because dry-run was on.

## Going live

When the dry-run triggers look right, flip the **LIVE** toggle in the top bar. It turns red as a reminder that the mouse and keyboard will now really act. Watch it against a harmless target (Notepad) before pointing it anywhere real.

To stop instantly at any time, press **Escape** — it's a global hotkey that halts the engine from any application. See [Safety](./safety) for the full list of stop mechanisms.

## Trying LLM mode with zero setup

You don't need a model installed to see how the LLM path works. Switch a profile to LLM mode and pick the **Mock** provider — it returns scripted decisions so you can watch the whole capture → decide → act loop run with no model and no API key. Then move to a real model when you're ready:

- **Local, free, private:** install [Ollama](https://ollama.com) and pull a _vision_ model: `ollama pull llama3.2-vision`.
- **Cloud:** put an API key in a `.env` file at the repo root and pick a provider.

Full details in [LLM mode](./llm-mode) and [Model providers](./providers).

## Command reference

| Command            | What it does                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `npm run dev`      | Daemon + UI with hot reload — the normal way to run autopoker.                                               |
| `npm run docs:dev` | This documentation site, locally, with hot reload.                                                           |
| `npm run check`    | The full quality gate: version-alignment, dead-code, lint, typecheck, tests, and a docs build.               |
| `npm test`         | The test suite across all packages.                                                                          |
| `npm run smoke`    | A manual native check: saves a screenshot of each monitor and moves the mouse to each one's center and back. |
