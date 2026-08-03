# Profiles & regions

## Profiles

A **profile** is a complete, named configuration: a set of regions plus every engine setting (mode, tick interval, dry-run, LLM settings, which strategy to use). You start, stop, and switch the engine one profile at a time.

Create profiles for different tasks or different windows. Switching profiles from the top-bar dropdown swaps the entire setup. Profiles are saved on disk automatically as you edit — there's no explicit "save profile" step.

## Regions

A **region** is a rectangle you draw on a monitor preview, plus what it means. Every region has a **purpose** that decides how the engine treats it:

| Purpose      | Meaning                                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| **automate** | The region runs its own list of actions when its condition fires. This is manual-mode automation.                             |
| **landmark** | The region carries no actions. It exists so an LLM can click it _by name_. This is what makes [LLM mode](./llm-mode) precise. |

A single profile can mix both. A common LLM setup is one `automate` region acting as a cheap "it's my turn" trigger, plus several `landmark` regions for the buttons the model might click.

## The region editor

Selecting a region (or drawing a new one) opens the editor. The fields, top to bottom:

- **name** — how you and the model refer to it. In LLM mode the model clicks a landmark by this name, matched case- and whitespace-insensitively.
- **enabled** — disabled regions are ignored by the engine entirely.
- **purpose** — automate or landmark, as above.
- **description** — a plain-English hint sent to the model (e.g. _"the fold button, bottom left of the table"_). Only used in LLM mode, but harmless otherwise.
- **condition** — what makes this region "match" (see below).
- **actions** — for automate regions, the steps to run when it triggers (see below).
- **confirm ticks / cooldown / re-arm** — timing controls (see below).

Below the editor are three buttons: **save region**, **test actions** (runs this region's actions once, respecting dry-run — a quick way to check a click lands where you expect), and **delete**.

## Conditions

A condition is evaluated against the pixels inside the region on every tick. There are four kinds:

| Condition                | Fires when                                                                 | Key setting                     |
| ------------------------ | -------------------------------------------------------------------------- | ------------------------------- |
| **color at point**       | A single pixel (relative to the region) is close to a target colour        | `tolerance` (0–255; default 10) |
| **region average color** | The region's _average_ colour is close to a target                         | `tolerance` (default 10)        |
| **looks like baseline**  | The region closely matches a snapshot you captured — "the button appeared" | `maxDiffPercent` (default 2)    |
| **changed vs baseline**  | The region has _diverged_ from a snapshot — "something changed here"       | `minDiffPercent` (default 10)   |

For the two baseline conditions, use the **capture baseline from current frame** button in the editor to snapshot what the region looks like right now; autopoker stores it and compares against it each tick.

Tolerance is a per-channel distance: `0` means an exact colour match, higher values are more forgiving. Diff percentages are the share of pixels that differ.

## Actions (automate regions)

When an automate region triggers, it runs its action list in order. The step types:

| Step           | Does                                                                        |
| -------------- | --------------------------------------------------------------------------- |
| **move mouse** | Move the pointer to the region's centre, or to explicit screen coordinates. |
| **click**      | Move then click. Choose button (left/right/middle) and single/double.       |
| **type text**  | Type a string.                                                              |
| **key tap**    | Press a key, optionally with modifiers (control/shift/alt/command).         |
| **delay**      | Wait a number of milliseconds before the next step.                         |

Steps run strictly one after another, and one region's whole sequence completes before any other action starts — the mouse never gets yanked mid-sequence.

## Timing controls

These prevent a matching condition from firing over and over:

- **confirm ticks** (default 2) — the condition must match this many ticks in a row before the region triggers. Debounces flicker.
- **cooldown ms** (default 3000) — after triggering, the region won't trigger again for at least this long.
- **re-arm** (default _after condition clears_) — when the region becomes eligible again:
  - _after cooldown_ — purely time-based; it can re-fire while the condition is still true.
  - _after condition clears_ — waits for the cooldown **and** at least one non-matching tick. This is what stops it clicking a button that stays visible forever.

The same region state machine (`armed → confirming → cooldown → armed`) drives both manual triggers and, in LLM mode, when the model gets consulted. See [the engine](/dev/engine) for the mechanics.
