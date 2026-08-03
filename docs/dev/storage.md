# Storage & data

autopoker persists everything under a single `data/` directory at the repository root (overridable with `AUTOPOKER_DATA_DIR`). It's gitignored. There's no database — everything is plain files, chosen so you can inspect and hand-edit them.

```
data/
├── profiles/
│   └── <profileId>.json         one file per profile
├── baselines/
│   └── <baselineId>.png         captured region snapshots
└── strategies/
    └── <strategyId>/
        ├── strategy.json        manifest: name, summary, attachment metadata
        ├── strategy.md          the markdown body — source of truth
        └── attachments/
            └── <id>__<filename>  uploaded files
```

## Profiles

`ProfileStore` (`packages/core/src/config-store.ts`) reads and writes one JSON file per profile, validated against `ProfileSchema` on both load and save. An unreadable or schema-invalid file is skipped rather than crashing the list — so a hand-edit that introduces a typo degrades gracefully.

A profile is the complete unit of configuration: its regions and all engine settings, including the entire LLM configuration and which strategy it points at.

## Baselines

`BaselineStore` (`baselines.ts`) stores each captured region snapshot as a PNG, keyed by a generated id that the region's condition references. On load it decodes PNGs into raw RGBA frames and caches them in memory; at runtime the condition evaluator diffs the live region against the cached baseline with `pixelmatch`. Saving a baseline writes the PNG and updates the cache in one step.

## Strategies

`StrategyStore` (`strategy-store.ts`) is the most structured store, because a strategy is more than a blob:

- The **markdown is a real `strategy.md` file** — the source of truth for the body. The UI writes it, but you can edit it in any editor and the daemon re-reads it on next load. The JSON manifest holds only metadata (name, summary, attachment list).
- **Attachments** are stored as raw files under `attachments/`, with filenames sanitised to `<id>__<original>` so an uploaded name can never escape the folder. Metadata (kind, media type, size) lives in the manifest.
- `loadContext(strategyId)` is what the LLM pipeline consumes: it returns the strategy plus every attachment's **bytes**, ready to become prompt content parts. This is the one place strategy files are read into memory for a model call, and the engine controller caches the result per run so files aren't re-read every tick.

Attachment kind is derived from media type: `image/*` → image, `application/pdf` → pdf, everything else → text. There's a 10 MiB per-attachment cap enforced on upload.

## Secrets are never stored

API keys are the deliberate exception to "everything is a file". They are **only** read from the environment (`process.env`), loaded from a gitignored `.env` at the repo root at daemon startup, or from the real environment. A profile's LLM settings can name _which_ environment variable to read (`apiKeyEnv`), but never the key itself. This keeps credentials out of the files you might share or commit.

## Why files, not a database

The stores are small, single-writer, and human-inspectable. Plain files mean you can diff a profile, hand-edit a strategy's markdown, drop in an attachment, or delete a baseline with `rm` — no migration, no schema server, no tooling. The zod schemas are the contract; the filesystem is the storage.
