# Renderer contract

A renderer is its own package. It is not built into PLGKit, and anyone can publish one. PLGKit ships a few in this repo: React first, then server page templates and phone apps.

## Usage

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

## Provider props

| Prop | Meaning |
| --- | --- |
| `location` | Sent once to `decide(location, context)`. Slots do not take a location. |
| `context` | Extra page facts, taken once and sent on every helper call. A component does not pass the org id itself. New fact names do not change the POST shape. |
| `endpoint` | Your own URL. PLGKit does not pick the path. |
| `registry` | The `component` name mapped to a real component, page template, or phone view. |
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
- `useNudgeTracking`, Python `nudge_tracking`, and the phone nudge tracking wrapper all return `{ click, dismiss }`. They share this contract: same `endpoint`, same `context`, same POST.
- `dismiss_on_click` means call `click`, then `dismiss`.
- Each helper call POSTs `{ nudge_id, action, context }` to `endpoint`. `action` is `impression`, `click`, or `dismiss`. `context` can be left out.
- The browser never sends `user_id`. If `context` includes `user_id`, ignore it. `user_id` always comes from the server session. If it is missing, ignore the event and do not throw an error into the page.
- Check each fact in `context`. Drop any fact you cannot check. Keep `organization_id` only when `session.user_belongs_to(org)`. The saved event is `{ user_id, ...checked context }`, sent to the matching PLGKit call (`impression`, `click`, or `dismiss`).
- You can skip the helper and call `impression`, `dismiss`, or `click` yourself with that same event. Then you must make sure a view is counted only once. Only count a view when the user actually sees it. A page loaded ahead of time, a page the server drew and then threw away, or a spot that never appears must not use up the view limit.
