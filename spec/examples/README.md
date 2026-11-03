# Examples

This folder is a sample setup you copy into your app.

## Where it goes

```
your-app/
  plgkit/
    nudges/
      config.yml
      messages/
        20261030183743-home-supersuit-launch-banner.yml
        20261102131452-get-started-supersuit-onboarding-modal.yml
      audiences.py
```

Use `audiences.go` or `audiences.ts` instead of `audiences.py` if your app is Go or TypeScript. Those samples are in `go/` and `typescript/`.

## What each file is

- `config.yml` sets where images live, how many messages a page can show, and the name of the environment variable that holds the database address.
- `messages/` holds one file per message. The filename is the message id.
- `audiences.py` (or `.go` / `.ts`) is where you say who should see a message.
- `decide-response.json` is an example of what the backend returns. You do not copy this file into your app.

## How it works

1. You write a message file.
2. Your backend calls `decide()` and gets back what to show.
3. The renderer shows that component.
4. Clicks and dismisses are sent with POST to your endpoint.

The React renderer is [`packages/react`](../../packages/react/README.md). It does not live in this folder. You pass a `decide` function that calls your backend and returns the list. The provider calls that function once for the page. Each slot then draws its own messages. `Banner` and `OnboardingModal` from that package match the two sample messages. To see that in the browser, run the [demo](demo/README.md).

```jsx
const decide = (location, context) => yourBackend.decide(location, context);
```

## Setup

1. In `config.yml`, `database_url_env` is the name of an environment variable. It is not the database address. The address can contain a password, so it stays out of the file you commit.
2. Set that variable to a SQLite address or a Postgres address (`postgres://` or `postgresql://`). For the sample config the name is `PLGKIT_DATABASE_URL`. If you leave it unset, plgkit uses a SQLite file named `plgkit_events.sqlite` in the folder you started the program from. That is enough to try things out.
3. Run `plgkit migrate`. This creates the `plgkit_events` table. Run it again when you update plgkit. It only applies new numbered files.

   Python is the default: `plgkit migrate` (from this repo: `python -m plgkit migrate` in `packages/python`).

   Go, from this repo: `go run ./packages/go/cmd/plgkit migrate`.

   TypeScript, from this repo: `node --experimental-strip-types packages/node/src/cli.ts migrate`.

4. Mount one handler on your own URL. Pass the signed-in user id from the session, and a `verify` map. Point the renderer's `endpoint` at that URL.

`verify` maps a context key to a function. The function is `(user_id, value) -> true or false`. A key with no function is dropped. A key whose function is not true is dropped. `user_id` inside `context` is ignored.

```python
from plgkit import handle_event

verify = {"organization_id": lambda user_id, value: user_belongs_to(user_id, value)}
```

Flask:

```python
@app.post("/api/nudges/events")
def nudges_events():
    return ("", handle_event(request.get_json(silent=True), session.get("user_id"), verify))
```

FastAPI:

```python
@app.post("/api/nudges/events")
def nudges_events(body: dict, user_id: str | None = Depends(current_user_id)):
    return Response(status_code=handle_event(body, user_id, verify))
```

TypeScript (`import { handleEvent } from "plgkit"`). Express:

```ts
app.post("/api/nudges/events", (req, res) => {
  res.sendStatus(handleEvent(req.body, req.session.userId, verify));
});
```

Next.js:

```ts
export async function POST(req: Request) {
  return new Response(null, { status: handleEvent(await req.json(), await currentUserId(), verify) });
}
```

Go (`import plgkit "github.com/plgkit/nudges/packages/go"`):

```go
mux.Handle("/api/nudges/events", plgkit.Handler(verify, func(r *http.Request) string {
    return sessionUserID(r)
}))
```

You can skip the handler and call `impression`, `click`, and `dismiss` yourself. A call with no `user_id` is ignored.

## Using it in a page

The home banner is location `home`, surface `main-top`, component `Banner`. The slot sits a few layers down. The provider calls `decide("home")` once for every slot on this page.

```jsx
<NudgeProvider location="home" endpoint="/api/nudges/events" context={{ organization_id: "acme" }} registry={{ Banner }} decide={decide}>
  <header>
    <div>
      <NudgeSurface surface="main-top" />
    </div>
  </header>
</NudgeProvider>
```

The onboarding modal is location `get-started`, surface `modal`, component `OnboardingModal`.

```jsx
<NudgeProvider location="get-started" endpoint="/api/nudges/events" context={{ organization_id: "acme" }} registry={{ OnboardingModal }} decide={decide}>
  <main>
    <NudgeSurface surface="modal" />
  </main>
</NudgeProvider>
```

Details: [messages/README.md](messages/README.md) and [renderers](../renderers.md).
