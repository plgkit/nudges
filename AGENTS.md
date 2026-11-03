# Instructions for coding agents

Read this before changing this repo, especially on Cloud Agent runs.

## Match what the human asked for

- Use **exact paths, command names, and flags** from the issue or chat (e.g. `script/server`, not `./server` at the repo root, not `npm start`, unless they agree to a change).
- If a handoff doc, discussion, or older PR text **conflicts** with the latest message, **stop and ask** which source wins. Do not silently follow the older spec.
- If you would **change product or UX shape** (append-only vs delete, new CLI behavior, new entrypoints), **describe the plan in chat and wait for approval** before coding. Small bugfixes and obvious typos are fine without asking.

## PLGKit norms (from maintainers)

- **Python first**, then TypeScript and Go, for the same behavior.
- **Flat config** except `locations`. **ELI5, scannable** docs.
- **Ask Chiedo** before non-trivial product or API changes unless the current task already includes approval.
- Reread the **full diff** before push. No confidential GitHub/Microsoft material in commits or docs.

## Demos and verification

- Prefer **fast checks** (unit tests, short commands). Do not leave **long-running** demo servers (`script/server`, Vite, backends) running in the background unless the task is to verify the demo end-to-end.
- **`script/server`** is the supported way to run the React demo (repo root). Default backend is Python; `--backend go` or `--backend node` when requested.
- **`plgkit undismiss`** is **dev-only**: it deletes dismiss and impression rows for that user and nudge. Not for production.

## Pull requests

- One focused PR per task. Say in the PR body when behavior **intentionally differs** from an linked discussion so review is easy.
