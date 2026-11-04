# plgkit

Small banners and modals in named slots on your site. You pick **what** to show in Python, TypeScript, or Go. React (for now) draws it.

## Try it

From `spec/examples/demo`:

```bash
npm install
script/server
```

Open the URL Vite prints. Switch users in the top bar, close the banner and modal, reload.

Other backends: `script/server --backend go` or `script/server --backend node`.

Details: [spec/examples/demo/README.md](spec/examples/demo/README.md).

## What happens on a page

```
  Your app                         plgkit_events (SQLite or Postgres)
  ─────────                        ─────────────────────────────────
  decide("home", ctx)  ──read──►   impressions, clicks, dismisses
        │
        ▼
  [ { id, surface, component, render_props }, ... ]
        │
        ▼
  React NudgeSurface("main-top")  ──POST──►  handle_event (impression / click / dismiss)
```

Your backend returns rows like this (one winner per surface, after caps and rules):

```json
[
  {
    "id": "20261030183743-home-supersuit-launch-banner",
    "surface": "main-top",
    "component": "Banner",
    "render_props": { "title": "…", "dismissible": true }
  }
]
```

The browser POSTs events; it does **not** send `user_id` (your session supplies that).

## Copy the sample into your app

```
your-app/
  plgkit/nudges/
    config.yml
    messages/*.yml
    audiences.py    # or audiences.go / audiences.ts
```

Walkthrough: [spec/examples/README.md](spec/examples/README.md).

## Repo map

| Path | What |
| --- | --- |
| [packages/python](packages/python), [packages/node](packages/node), [packages/go](packages/go) | `decide()`, `handle_event` / `HandleEvent`, `plgkit migrate` |
| [packages/react](packages/react) | `NudgeProvider`, `NudgeSurface`, sample `Banner` / `OnboardingModal` |
| [spec/examples](spec/examples) | Sample config, messages, audiences |
| [spec/examples/demo](spec/examples/demo) | Browser demo + backends; run `script/server` from this folder |
| [core/migrations](core/migrations) | SQL schema (copied into each language package) |

Renderer notes: [spec/renderers.md](spec/renderers.md).

## Dev-only reset

Closed a nudge and want it back locally?

```bash
plgkit undismiss <nudge_id> --user <user_id>
```

Deletes that user’s dismiss and impression rows for the nudge. Not for production.

## Agents

See [AGENTS.md](AGENTS.md) if you use Cursor Cloud Agents on this repo.
