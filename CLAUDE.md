I want to have a robot that controls my computer.
The the whole idea is to have periodic screenshots of all the  
available monitors and control the mouse via robot.js based on those screenshots.

The screenshots will be fed to an LLM (Large Language Model) that will analyze the images and determine the appropriate actions to take, such as moving the mouse, clicking, or typing. The LLM will generate commands that will be sent back to the robot.js script to execute on the computer.

For the mvp , we can start with a simple implementation that captures screenshots at regular intervals, skip the LLM for now, and executes basic mouse movements and clicks. For this i wanna have a mode where i can register specific areas of the screen (like buttons or input fields) and define actions for those areas. The robot will then monitor those areas and perform the defined actions when certain conditions are met (like a button appearing or a specific color change).

The whole app should use typescript, npm monorepo, prettier, eslint, vitest, react, knip, lint-staged, syncpack where appropriate. The project structure should be organized in a way that separates the core functionality (screenshot capturing, mouse control) from the user interface and configuration.

## Documentation is part of every change

There is a documentation site under `docs/` (VitePress): a **user guide** in `docs/guide/` and a **developer guide** in `docs/dev/`. These docs are not an afterthought — they are part of the definition of done.

**On every edit that changes observable behaviour, configuration, the WebSocket protocol, the zod schemas, safety mechanisms, or the developer-facing architecture, update the relevant `docs/` page in the SAME change.** Do not leave docs to a follow-up. If a change makes a docs page inaccurate, the change is not complete until the page is fixed.

Which page to touch:

| You changed… | Update… |
| --- | --- |
| a schema, default, or config field | the relevant `docs/guide/` page, and `docs/dev/storage.md` if persistence changed |
| the engine loop, region state machine, or action queue | `docs/dev/engine.md` |
| anything model/provider/prompt-related | `docs/dev/llm.md`, plus `docs/guide/llm-mode.md` / `docs/guide/providers.md` / `docs/guide/strategies.md` if user-facing |
| a WebSocket message | `docs/dev/protocol.md` |
| a new provider, condition, action, or decider | `docs/dev/extending.md` and the matching user-guide page |
| a safety mechanism | `docs/guide/safety.md` |
| the build/test/dev workflow | `docs/dev/workflow.md` |

Rules:

- **Prose must stay true to the code, not merely link-valid.** When you rename a field, change a default, or alter behaviour, fix the sentences that describe it — don't just fix links.
- The docs build runs inside `npm run check` and **fails on dead internal links**, so keep cross-links valid. Use `npm run docs:dev` to preview, `npm run docs:build` to verify.
- When adding a new page, add it to the sidebar in `docs/.vitepress/config.ts`.
- Keep the two audiences separate: end-user how-to in `docs/guide/`, implementation detail in `docs/dev/`.
- The top-level `README.md` stays a short orientation + quick-start that points at the docs site; put depth in `docs/`, not the README.