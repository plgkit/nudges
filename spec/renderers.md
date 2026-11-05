# Renderer contract

React draws nudges. Use a React front end, or inline React on a page served by Python, Go, or TypeScript. The provider, the slots, and the events are the same either way.

The renderer lives in its own package, beside `decide`. This repo ships [packages/react](../packages/react/README.md).

## React front end

```jsx
function decide(location, context) {
  return yourBackend.decide(location, context);
}

<NudgeProvider
  location="home"
  endpoint="/api/nudges/events"
  context={{ organization_id: "acme" }}
  registry={{ Banner }}
  decide={decide}
>
  <header>
    <div>
      <NudgeSurface surface="main-top" />
    </div>
  </header>
</NudgeProvider>

function Banner(props) {
  const { click, dismiss } = useNudgeTracking(props.nudge_id);
}
```

The provider calls `decide(location, context)` once, so the page limits cover every slot. Each item is `{ id, surface, component, render_props }`. A slot shows only items with that `surface`. The component is `<Banner {...item.render_props} nudge_id={item.id} />`.

## Inline React

A Python, Go, or TypeScript server can keep sending the rest of the page as HTML. Inline the React provider on the slot.

Build this file and serve the result at `/nudges.js`. The demo uses Vite.

```jsx
import { createRoot } from "react-dom/client";
import { NudgeProvider, NudgeSurface, Banner } from "@plgkit/nudges-react";

const decide = async (location, context) => {
  const response = await fetch("/api/nudges/decide", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ location, context }),
  });
  if (!response.ok) return [];
  const body = await response.json();
  return Array.isArray(body) ? body : [];
};

const slot = document.getElementById("nudge-main-top");
if (slot) {
  createRoot(slot).render(
    <NudgeProvider
      location="home"
      endpoint="/api/nudges/events"
      context={{ organization_id: "acme" }}
      registry={{ Banner }}
      decide={decide}
    >
      <NudgeSurface surface="main-top" />
    </NudgeProvider>,
  );
}
```

`decide` POSTs `{ location, context }` to your route. Read the user from the session, call `decide` with your messages, audiences, and config, and return the list. Copy that route from the demo backend for your language: [Python](examples/demo/backends/python/server.py), [TypeScript](examples/demo/backends/node/server.ts), or [Go](examples/demo/backends/go/main.go). Events still go to `endpoint`.

The tour page is the same file with `location="get-started"`, `registry={{ OnboardingModal }}`, and `<NudgeSurface surface="modal" />`. The modal draws on `document.body`.

Put the div and the script on the page.

Python (Flask). `home.html`:

```html
<header>
  <div id="nudge-main-top"></div>
</header>
<script type="module" src="/nudges.js"></script>
```

```python
@app.get("/")
def home():
    return render_template("home.html")
```

Go:

```go
func home(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "text/html; charset=utf-8")
    io.WriteString(w, `<header>
  <div id="nudge-main-top"></div>
</header>
<script type="module" src="/nudges.js"></script>`)
}
```

TypeScript (Express):

```ts
app.get("/", (_req, res) => {
  res.type("html").send(`<header>
  <div id="nudge-main-top"></div>
</header>
<script type="module" src="/nudges.js"></script>`);
});
```

## Provider props

| Prop | Meaning |
| --- | --- |
| `location` | Sent once to `decide(location, context)`. Slots do not take a location. |
| `context` | Extra page facts, taken once and sent on every helper call. A component does not pass the org id itself. New fact names do not change the POST shape. |
| `endpoint` | Your own URL. PLGKit does not pick the path. |
| `registry` | The `component` name mapped to a React component. |
| `decide` | A function you write. We call `decide(location, context)` once for the page. It asks your backend and returns the list to show. We do not pick the messages. We call it again only when the location or the context values change. A new object with the same values does not call it again. `user_id` is left out. |

## Surface props

| Prop | Meaning |
| --- | --- |
| `surface` | Which slot this is. It shows only the provider's items with this `surface`. Put it anywhere inside the provider, even several layers down. No location prop. |

## What each component gets

| Prop | Meaning |
| --- | --- |
| `nudge_id` | `item.id`: the message file name, with its date-and-time prefix, without `.yml`. It is not a field in the message file, and it is not written into `render_props`. |
| `...render_props` | Passed through as-is. The renderer does not read `assets_base_url`. The component gets finished image URLs. If `render_props` also has `nudge_id`, the renderer's value wins. |

## Rules

- If `component` is missing or not in the registry, show nothing and write a warning. Do not crash the page.
- A `NudgeSurface` outside a provider shows nothing and writes a warning. It does not break the page.
- A view is counted once per `decide()` result, and that count is not returned to the component. Drawing the component again does not count. The count starts over on each new `decide()` result.
- `useNudgeTracking(nudge_id)` returns `{ click, dismiss }`. Both use the provider's `endpoint` and `context`, and POST the same body.
- `dismiss_on_click` means call `click`, then `dismiss`. The sample `OnboardingModal` with `dismissible: false` advances on earlier slides and only calls `dismiss` on the last one.
- Each helper call POSTs `{ nudge_id, action, context }` to `endpoint`. `action` is `impression`, `click`, or `dismiss`. `context` can be left out.
- The browser never sends `user_id`. If `context` includes `user_id`, the server ignores it. `user_id` always comes from the server session. If it is missing, the server writes nothing and does not throw an error into the page.
- On the server, pass the parsed body to `handle_event` (Python), `handleEvent` (TypeScript), or `HandleEvent` (Go). Give it a `verify` map: context key to `(user_id, value) -> true or false`. Keep `organization_id` only when that function says the user belongs to the org. Keys with no function, or a function that is not true, are dropped. A bad body is status 400. A saved or ignored event is status 204. The saved row is `{ user_id, ...checked context }` in `plgkit_events`.
- You can skip the handler and call `impression`, `dismiss`, or `click` yourself with that same event. Then you must make sure a view is counted only once. Only count a view when the user actually sees it. A page loaded ahead of time, a page the server drew and then threw away, or a spot that never appears must not use up the view limit.
