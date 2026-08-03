# Troubleshooting

## The UI says "disconnected"

The browser can't reach the daemon at `ws://localhost:8787`.

- Check the terminal running `npm run dev` — did the server side start, or did it error?
- **`EADDRINUSE: 8787`** means a previous daemon is still holding the port. Free it and restart:

  ```powershell
  Get-NetTCPConnection -LocalPort 8787 -State Listen |
    Select-Object -Expand OwningProcess -Unique |
    ForEach-Object { Stop-Process -Id $_ -Force }
  ```

- The UI reconnects on its own once the daemon is back — no need to refresh, though a hard refresh (Ctrl+F5) doesn't hurt.

## No monitor previews appear

- Confirm the **connected** pill is green first (see above).
- Previews only stream to a connected UI. If the pill is green but images don't appear, check the event log and the daemon terminal for capture errors.

## Clicks land in the wrong place

autopoker maps preview pixels → capture pixels → screen coordinates, accounting for monitor position and DPI scaling. If clicks are off:

- Use a region's **test actions** button (dry-run off) to click its centre and see where the pointer actually goes.
- Verify you drew the region on the correct monitor's preview.
- The `npm run smoke` script moves the mouse to each monitor's centre and back, which confirms the basic coordinate mapping independent of the UI.

## LLM mode: "the model did not return a valid decision"

The model's output didn't match the required structure.

- Small local models struggle with structured output. Try a more capable vision model, or a cloud provider, to confirm it's a model-capability issue.
- Keep the strategy focused — an overloaded prompt makes structured output less reliable.
- Check the event log for the specific error.

## LLM mode: decisions are never executed

Look at the **skipped reason** on the decision card or in the event log:

- _"dry-run: the actions were not performed"_ — you're in dry-run. Flip to LIVE.
- _"confidence … is below the … threshold"_ — the model wasn't sure enough. Lower `min confidence`, or improve the strategy so the model is more confident.
- _"unknown region …"_ — the model named a landmark that doesn't exist. Fix the name in your strategy, or add the landmark.
- _"above the cap of …"_ — the decision had too many actions. Raise `max actions`, or make the strategy propose fewer steps.
- _"the model chose to wait"_ — working as intended; nothing to do.
- _"the model returned an empty decision …"_ — usually **thinking: off** on a thinking-only model build (e.g. `qwen3-vl:32b`). Switch thinking back to _model default_, or pull an instruct build (`qwen3-vl:32b-instruct`). See [Model providers](./providers#local-models-with-ollama).

## LLM mode: it costs too much / calls the model too often

- Set the **trigger** to _when a region condition fires_ rather than _every tick_, and add a cheap pixel region that only matches when action is actually needed.
- Raise **min gap ms** — it's a hard floor between calls.

## Ollama: "reachable but the model is not installed"

The connection works but the named model isn't pulled. The message includes the exact command — for example:

```sh
ollama pull llama3.2-vision
```

Remember the model must be a **vision** model.

## API key not picked up

- Keys come from the environment or a `.env` at the repo root — never from a profile.
- The daemon loads `.env` **at startup**. If you added the key after starting, restart `npm run dev`.
- Check the **API key env var** field points at the right variable name for that provider.

## Where to look

The **event log** at the bottom of the sidebar is the first place to check — it records triggers, decisions, connection changes, kill-switch events, and errors. For deeper issues, the daemon's terminal has the full server-side logs.
