# Safety

autopoker moves a real mouse and types on a real keyboard. These are the mechanisms that keep that under control. Understand them before you go live.

## Dry-run is the default

Every profile starts in **dry-run**. In dry-run the engine does everything — captures, evaluates, and in LLM mode _asks the model and shows its decision_ — but never actually moves the mouse or types. The event log shows exactly what _would_ have happened.

Going live is a deliberate act: the **LIVE** toggle in the top bar, which turns red. Always watch a new configuration in dry-run first.

## The kill switch (Escape)

While the engine runs, pressing **Escape** halts it instantly. It's a **global** hotkey — it works from any application, so you don't need the autopoker window focused. It stops the engine, clears any queued actions, and reports why it stopped.

The hotkey is configurable per profile (default `Escape`).

## The corner failsafe

Slamming the mouse pointer into the **top-left corner of the primary monitor** (coordinates 0,0) hard-stops the engine. This is checked every tick _and_ before every individual action step, so even mid-sequence you can bail out by throwing the mouse to the corner. It works even if the kill-switch hotkey somehow fails.

This is on by default and can be toggled per profile.

## One action at a time

All actions run through a single serial queue. One decision's whole sequence — every click, keystroke, and delay — completes before the next begins. The mouse is never yanked to a new place mid-sequence, and two decisions can never interleave.

The queue also has a depth cap: while it's busy, new triggers are dropped rather than piling up. A slow or stuck action can't cause a backlog that fires all at once later.

## Rate limits and debouncing

- **confirm ticks** — a condition must hold for several ticks before it counts, so a one-frame flicker never triggers anything.
- **cooldown** — after a region triggers, it won't trigger again for a set time.
- **re-arm policy** — with _after condition clears_, a region won't re-fire until the condition has actually gone away and come back, so a permanently-visible button is clicked once, not forever.
- **min gap ms** (LLM mode) — a hard floor between model consultations.

## LLM-specific guards

- **confidence threshold** — decisions the model is less sure about than your `min confidence` (default 0.5) are logged but never executed.
- **action cap** — a decision with more than `max actions` (default 4) steps is rejected whole.
- **all-or-nothing translation** — if any part of a decision can't be resolved to a real, on-screen target (an unknown landmark name, off-screen coordinates), the entire decision is discarded. It is never partially executed.
- **single call in flight** — the engine awaits each model decision before continuing, so slow models slow the loop instead of spawning concurrent calls.

## A safe rollout, every time

1. Configure against a **harmless target** — Notepad, a throwaway window.
2. Keep **dry-run on** and watch the event log until triggers/decisions are consistently correct.
3. In LLM mode, use **ask the model once** to vet decisions before even starting the engine.
4. Flip to **LIVE** and keep watching, ready to hit Escape.
5. Only then point it at the real thing.

::: warning
No safety mechanism substitutes for supervision while you're setting something up. Keep a hand near Escape until you trust a configuration.
:::
