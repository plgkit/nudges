# Nudges

You already run ads inside your product. You just call them banners, tours, and "one last modal."

The first is an `if`. The fifth is a fight. Nudges is the little ad server for that fight: YAML copy, Python / TypeScript / Go picks the winner, React draws it — in a React app, or [dropped onto](spec/renderers.md#inline-react) a page those servers already send.

![Home page with a dismissible banner above the sub-suit dashboard](docs/home.png)

## What you are not going to build

- **Priority.** Lowest number wins. Tie: older file. No number? You're a 100.
- **Caps.** Page full = stop, even if a later slot is empty. Config, not the message.
- **Dismiss.** Gone for that person, or that org. Views count on screen, once per `decide()`.
- **Audience.** Skip it for everyone. Or your functions: all of / one of / none of. Unknown name skips it.
- **Schedule.** `active.from` / `active.to`, UTC. Kill it in YAML.
- **The log.** SQLite or Postgres. Browser never sends `user_id`. Session does.

A bad message is skipped. The page keeps working.

## Try it

Demo sells supersuits. Close the banner, finish the tour, switch users.

From `spec/examples/demo`:

```bash
npm install
script/server
```

Vite prints a URL. `--backend go` or `--backend node` if you want. [What to click](spec/examples/demo/README.md).

## Put it in your app

```
your-app/plgkit/nudges/
  config.yml
  messages/*.yml
  audiences.py      # or .go / .ts
```

`plgkit migrate` once. No `PLGKIT_DATABASE_URL` means local SQLite. From this repo: `python -m plgkit migrate` in `packages/python`.

```python
from plgkit import handle_event

verify = {"organization_id": lambda user_id, value: user_belongs_to(user_id, value)}

@app.post("/api/nudges/events")
def nudges_events():
    return ("", handle_event(request.get_json(silent=True), session.get("user_id"), verify))
```

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

Go, TypeScript, YAML: [spec/examples/README.md](spec/examples/README.md).

[python](packages/python) · [node](packages/node) · [go](packages/go) · [react](packages/react) · [demo](spec/examples/demo) · [renderers](spec/renderers.md)

## Show it again (dev)

```bash
plgkit undismiss <nudge_id> --user <user_id>
```

Wipes that person's dismiss and impression rows. Not production.

[AGENTS.md](AGENTS.md) for Cursor Cloud Agents.
