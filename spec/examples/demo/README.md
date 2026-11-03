# Try the nudges

One page. Three backends. Pick one backend, then start the page. They all listen on port 8787, so run only one at a time.

You do not set a database address. Events go in `plgkit_events.sqlite` in this folder (`spec/examples/demo/plgkit_events.sqlite`). That file is not committed.

## Start a backend

Run these from this folder.

| Backend | Command |
| --- | --- |
| Python | `PYTHONPATH=../../../packages/python python3 -m plgkit migrate && PYTHONPATH=../../../packages/python python3 backends/python/server.py` |
| Go | `go run ../../../packages/go/cmd/plgkit migrate && go run ./backends/go` |
| TypeScript | `node --disable-warning=ExperimentalWarning --experimental-strip-types ../../../packages/node/src/cli.ts migrate && node --disable-warning=ExperimentalWarning --experimental-strip-types backends/node/server.ts` |

`plgkit migrate` creates the events file. The second half starts the backend.

Install the page once before the TypeScript backend (`npm install` below). That backend reads the sample messages with the `yaml` package from this folder.

## Start the page

In a second terminal, from this folder:

```
npm install && npm run dev
```

Open the address Vite prints.

## What to click

The top bar says who is signed in. **user_one** is orange. **user_two** is blue. Pick a name to switch. The server remembers that person in a cookie. The page does not send the user id.

Home shows the banner. Get started shows the onboarding window. Press **Close** on each. Reload: they stay hidden for this person. Switch to the other person: both show again.
