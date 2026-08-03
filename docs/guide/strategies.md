# Writing strategies

A **strategy** is how you tell the model what to do. It's markdown you write in the **strategy** tab, optionally with attachments, and it's sent to the model verbatim as context on every consultation. A profile in LLM mode points at one strategy.

## Creating one

In the **strategy** tab: type a name, click **+ strategy**, then fill in:

- **name** — for your own reference.
- **summary** — one line describing the game or app, shown to the model as a header.
- **strategy (markdown)** — the body. This is the important part.
- **reference material** — optional file attachments (see below).

Edits are held until you click **save strategy**, so you can draft freely.

## How strategies are stored

Each strategy is a folder on disk under `data/strategies/<id>/`:

```
data/strategies/<id>/
├── strategy.json      manifest (name, summary, attachment metadata)
├── strategy.md        the markdown body — the source of truth
└── attachments/       uploaded files
```

The markdown is a **real `.md` file**. You can edit it in your own editor and autopoker picks up the change the next time it loads the strategy. The UI is convenient, not mandatory.

## Attachments

Attach images, PDFs, or text files as reference material — range charts, rule sheets, annotated screenshots of what to look for. All of it is sent to the model alongside the strategy.

- **Images** and **text** go to every provider.
- **PDFs** go natively to Anthropic, OpenAI, and Google. For Ollama and other local models, autopoker extracts the PDF's text first and sends that, since local models can't accept PDF file parts.

There's a size limit per attachment (10 MiB).

## Writing a strategy that works

The model sees your strategy, a screenshot, and a list of clickable **landmarks** by name. Write for that.

**Refer to landmarks by their exact names.** If you have a landmark called "Fold button", write _"click Fold button"_, not _"click the fold option"_. The model is told the landmark names and is far more reliable clicking a name it was given.

**Be explicit about when to do nothing.** The model is instructed that waiting is always safe and guessing is not, but reinforce it: tell it plainly _"if it's not your turn, wait"_. A model that waits appropriately is worth more than one that acts constantly.

**Describe observable state, not intentions.** The model can only see the screenshot. "If the pot is over 100" works (it's on screen); "if you've been losing" doesn't (it can't know that unless it's visible).

**Keep it focused.** One clear decision procedure beats a sprawling document. Long, meandering strategies dilute the instructions that matter.

### A small example

```markdown
# Six-max cash game

You are playing one hand at a time. Act only when it is your turn.

## When it is my turn

- If the screen shows it is NOT my turn (no highlighted action buttons),
  wait.
- With a strong hand (pair of tens or better), click "Raise button",
  then type 3x the big blind, then press enter.
- With a weak hand out of position, click "Fold button".
- When unsure, click "Fold button" — folding is safe.
```

## The tuning loop

Don't start the engine to test a strategy. Use **ask the model once** in the model tab:

1. Set the game to a state you want to test.
2. Click **ask the model once**.
3. Read the decision card: what the model _saw_, _why_ it chose what it did, its confidence, and the exact steps.
4. Adjust the markdown and repeat.

Only once the one-shot decisions are consistently right should you start the engine in dry-run, then go live. See [LLM mode](./llm-mode#tuning-ask-the-model-once).
