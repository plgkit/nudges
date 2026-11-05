# Nudges

**In-product advertising for your own product.**

Banners and short tours in slots you name. A few messages want the same spot. Nudges ranks them, remembers who already saw them, and stays quiet after dismiss.

Python, TypeScript, or Go picks the winner. React draws it, in a React app or [inlined](spec/renderers.md#inline-react) on a page those servers already send.

![Home page with a dismissible banner above the sub-suit dashboard](docs/home.png)

## The small ad server

These are the jobs a homemade banner system grows into. They ship here, the same way in every language.

- **Priority.** Lower number wins. Tie goes to the older message. Forgot a number? It sorts as 100.
- **Inventory.** The page has a cap. Each slot has a cap. When the page is full, the rest stay off it, even if a later slot still had room.
- **Memory.** Dismiss sticks for that person, or for one org if you scope it that way. A view counts when it is actually on screen, once each time you ask. Drawing it again does not spend another view.
- **Audience.** Everyone, unless you say otherwise. Your functions can require all, require one, or exclude. An unknown name skips the message.
- **Schedule.** A UTC window on the message. Turn it on and off without touching the component.
- **The record.** Impressions, clicks, and dismisses go to SQLite or Postgres. The browser does not send the user id. Your session does.

A bad message is skipped. The page stays up.

## Try the supersuit

The sample product sells supersuits. The banner and the tour are ordinary nudges.

From `spec/examples/demo`:

```bash
npm install
script/server
```

Open the URL Vite prints. Close the banner, finish the tour, reload. Switch users in the top bar. The other person still sees both.

Other backends: `script/server --backend go` or `script/server --backend node`.

[What to click](spec/examples/demo/README.md).

## Add a slot

```
your-app/plgkit/nudges/
  config.yml        # how many messages a page may show
  messages/*.yml    # one message per file
  audiences.py      # or audiences.go / audiences.ts
```

1. `plgkit migrate` once. No `PLGKIT_DATABASE_URL` means a local SQLite file. Point it at Postgres when you want that. From this repo: `python -m plgkit migrate` in `packages/python`.
2. One events route. The signed-in user comes from the session.

```python
from plgkit import handle_event

verify = {"organization_id": lambda user_id, value: user_belongs_to(user_id, value)}

@app.post("/api/nudges/events")
def nudges_events():
    return ("", handle_event(request.get_json(silent=True), session.get("user_id"), verify))
```

3. Ask once for the page, then draw the slot.

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

Go and TypeScript routes, message fields, and the tour: [spec/examples/README.md](spec/examples/README.md).

## Map

| Path | What |
| --- | --- |
| [packages/python](packages/python), [packages/node](packages/node), [packages/go](packages/go) | Pick the message, save the event, migrate |
| [packages/react](packages/react) | The slot, plus sample `Banner` and `OnboardingModal` |
| [spec/examples](spec/examples) | Sample messages, audiences, and config |
| [spec/examples/demo](spec/examples/demo) | The supersuit, three backends |
| [spec/renderers.md](spec/renderers.md) | React, and inline React |
| [core/migrations](core/migrations) | The SQL |

## Local do-over

Closed one and want it back on your machine?

```bash
plgkit undismiss <nudge_id> --user <user_id>
```

Dev only. It deletes that person's dismiss and impression rows for that one nudge.

## Agents

[AGENTS.md](AGENTS.md) if you use Cursor Cloud Agents on this repo.
