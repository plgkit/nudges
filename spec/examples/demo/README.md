# Try the nudges

One page. Three backends. From this folder:

```
npm install
npm start
```

That runs `plgkit migrate`, starts the **Python** backend on port 8787, then Vite for the page. Vite proxies `/api` to the backend.

Other backends:

```
npm start -- --backend go
npm start -- --backend node
```

You do not set a database address. Events go in `plgkit_events.sqlite` in this folder (`spec/examples/demo/plgkit_events.sqlite`). That file is not committed.

## Start a backend only

If you want two terminals yourself:

| Backend | Command |
| --- | --- |
| Python | `PYTHONPATH=../../../packages/python python3 -m plgkit migrate && PYTHONPATH=../../../packages/python python3 backends/python/server.py` |
| Go | `go run ../../../packages/go/cmd/plgkit migrate && go run ./backends/go` |
| TypeScript | `node --disable-warning=ExperimentalWarning --experimental-strip-types ../../../packages/node/src/cli.ts migrate && node --disable-warning=ExperimentalWarning --experimental-strip-types backends/node/server.ts` |

Then in another terminal: `npm run dev`.

The TypeScript backend reads sample messages with the `yaml` package from this folder (`npm install` once).

## What to click

The top bar says who is signed in. **user_one** is orange. **user_two** is blue. Pick a name to switch. The server remembers that person in a cookie. The page does not send the user id.

Home shows the banner. Get started shows the onboarding window. Press **Close** on each. Reload: they stay hidden for this person. Switch to the other person: both show again.

Dev only: to show a message again for **user_one**, run `plgkit undismiss <nudge_id> --user 1` from this folder (same `plgkit` as your backend). That deletes dismiss and impression rows for that user and nudge (view cap resets). Example: `plgkit undismiss 20261030183743-home-supersuit-launch-banner --user 1`.
