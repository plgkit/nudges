# Try the nudges

One page. Three backends.

You do not set a database address. Events go in `plgkit_events.sqlite` in this folder (`spec/examples/demo/plgkit_events.sqlite`). That file is not committed.

## Run everything

From this folder (once: `npm install`):

```
./server
./server --backend go
./server --backend node
```

That runs `plgkit migrate`, starts the API on port **8787** (Python by default), then Vite. Open the URL Vite prints. Ctrl+C stops both.

From the repo root you can run the same:

```
./server
./server --backend node
```

## Backend only

If you want the page in a separate terminal:

| Backend | Command |
| --- | --- |
| Python | `PYTHONPATH=../../../packages/python python3 -m plgkit migrate && PYTHONPATH=../../../packages/python python3 backends/python/server.py` |
| Go | `go run ../../../packages/go/cmd/plgkit migrate && go run ./backends/go` |
| TypeScript | `node --disable-warning=ExperimentalWarning --experimental-strip-types ../../../packages/node/src/cli.ts migrate && node --disable-warning=ExperimentalWarning --experimental-strip-types backends/node/server.ts` |

Then: `npm run dev`.

The TypeScript backend reads sample messages with the `yaml` package from this folder (`npm install` once).

## What to click

The top bar says who is signed in. **user_one** is orange. **user_two** is blue. Pick a name to switch. The server remembers that person in a cookie. The page does not send the user id.

Home shows the banner. Get started shows the onboarding window. Press **Close** on each. Reload: they stay hidden for this person. Switch to the other person: both show again.

Dev only: to show a message again for **user_one**, run `plgkit undismiss <nudge_id> --user 1` from this folder (same `plgkit` as your backend). That deletes dismiss and impression rows for that user and nudge (view cap resets). Example: `plgkit undismiss 20261030183743-home-supersuit-launch-banner --user 1`.
