# Nudges

Small banners and modals in named slots on your site. You pick **what** to show in Python, TypeScript, or Go. React (for now) draws it.

![Home page with a dismissible banner above the sub-suit dashboard](docs/home.png)

## Try it

From `spec/examples/demo`:

```bash
npm install
script/server
```

Open the URL Vite prints. Switch users in the top bar. Home has a banner you can close. Get started is a short tour. The last slide dismisses it.

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

Your backend returns one list for the page. Each slot draws the rows for its surface.

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

The browser POSTs events. It does **not** send `user_id`. Your session supplies that.

## Use it in your app

Copy the sample:

```
your-app/
  plgkit/nudges/
    config.yml
    messages/*.yml
    audiences.py    # or audiences.go / audiences.ts
```

1. Leave `PLGKIT_DATABASE_URL` unset to use a local SQLite file, or point it at Postgres. Run `plgkit migrate` once. From this repo, Python is `python -m plgkit migrate` in `packages/python`.
2. Mount one events route. Pass the signed-in user from the session.

```python
from plgkit import handle_event

verify = {"organization_id": lambda user_id, value: user_belongs_to(user_id, value)}

@app.post("/api/nudges/events")
def nudges_events():
    return ("", handle_event(request.get_json(silent=True), session.get("user_id"), verify))
```

3. On the page, ask your backend for the list and draw a slot.

```jsx
const decide = (location, context) => yourBackend.decide(location, context);

<NudgeProvider
  location="home"
  endpoint="/api/nudges/events"
  context={{ organization_id: "acme" }}
  registry={{ Banner }}
  decide={decide}
>
  <NudgeSurface surface="main-top" />
</NudgeProvider>
```

Go and TypeScript handlers, and the onboarding modal slot: [spec/examples/README.md](spec/examples/README.md).

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
