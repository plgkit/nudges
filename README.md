# Nudges

You already run ads inside your product. You just call them banners, tours, and "one last modal."

The first is an `if`. The fifth is a fight. Nudges is the little ad server for that fight: YAML copy, Python / TypeScript / Go picks the winner, React draws it — in a React app, or [dropped onto](spec/renderers.md#inline-react) a page those servers already send. The license is [MIT](LICENSE).

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

## Install

The package metadata is ready for a registry. Nothing is published yet. Grab the source from this repository. We will publish to PyPI, npm, and the Go module proxy if there is interest.

```bash
git clone https://github.com/plgkit/nudges.git
```

| Language | From the clone | What you get |
|---|---|---|
| Python | `pip install ./nudges/packages/python` | `plgkit` and the `plgkit` command. Python 3.10 or newer. |
| TypeScript | `npm install ./nudges/packages/node` | `plgkit` on Node 22.13 or newer. The entry file is TypeScript. |
| Go | `go get github.com/plgkit/nudges@main` | `github.com/plgkit/nudges/packages/go`. Run this inside your Go module. |
| React | `npm install ./nudges/packages/react` | `@plgkit/nudges-react`. React 18 or newer. The entry files are TypeScript. |

Python can also install straight from GitHub:

```bash
pip install "plgkit @ git+https://github.com/plgkit/nudges.git#subdirectory=packages/python"
```

TypeScript and React install from the cloned package directories. Each npm package lives in its own folder, so a GitHub URL of the repository root has no `package.json` to install.

Go imports the package after `go get`:

```go
import plgkit "github.com/plgkit/nudges/packages/go"
```

From a checkout, Node and Go run migrate like this:

```bash
node --experimental-strip-types packages/node/src/cli.ts migrate
go run ./packages/go/cmd/plgkit migrate
```

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
