# The UI

The whole tool is driven from one browser page at `http://localhost:5173`. It has three areas: a top bar, a live preview of your monitors, and a tabbed sidebar.

## Top bar

The top bar is always visible and controls the engine as a whole.

| Control                           | What it does                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **connected / disconnected** pill | Whether the browser is talking to the daemon. Reconnects automatically.                              |
| **profile** dropdown              | Which profile is active. A profile bundles regions and all engine settings.                          |
| **+ profile**                     | Create a new profile.                                                                                |
| **▶ start / ■ stop**              | Run or halt the engine on the selected profile.                                                      |
| **LIVE / dry-run** toggle         | Whether actions actually execute. **Dry-run is the default and shows a calm state; LIVE turns red.** |
| **running** pill                  | Appears while the engine runs, showing the tick interval and whether the kill switch is armed.       |

## Monitor previews

Each monitor is shown as a live image, updated about once a second. This is where you register regions:

- **Drag a rectangle** on a preview to create a new region there.
- **Registered regions** are drawn as labelled boxes. Their colour reflects live status — selected, matched, in cooldown, or disabled.
- Coordinates are handled for you. You draw in the preview; autopoker maps that to real capture pixels and, at click time, to real screen coordinates — including monitors positioned to the left of your primary (negative coordinates) and high-DPI scaling.

## Sidebar tabs

The sidebar has three tabs.

### regions

The list of regions in the active profile, plus the region editor when one is selected. This is where manual automation lives, and where you register the **landmarks** that make LLM mode accurate. See [Profiles & regions](./regions).

### strategy

Where you write and manage strategies for LLM mode: a markdown editor plus attachment uploads. See [Writing strategies](./strategies).

### model

Where you choose the mode (manual vs LLM), and in LLM mode configure the provider, model, trigger, and safety limits. It also has the **ask the model once** button — the single most useful control for tuning. See [LLM mode](./llm-mode).

When a profile is in LLM mode, the **model** tab shows a small ● marker so you can tell at a glance.

## The event log

At the bottom of the sidebar is a running log of everything the engine does: regions triggering, decisions the model made, connection status, kill-switch events, and errors. Decision entries are colour-coded and show the model's confidence and latency. It's the first place to look when something behaves unexpectedly.
