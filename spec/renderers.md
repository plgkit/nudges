# Renderer contract

A renderer is a separate importable package. It is not a core plugin. Anyone can publish one against this contract. PLGKit ships a few in the nudges repo. React is first. Server templates and mobile come later.

A renderer must:

- Keep a registry from the `component` string to a real component, template, or view.
- Render the matching `decide()` item by passing `nudge_id` and `render_props`. The item shape is `{ id, surface, component, render_props }`. `nudge_id` is `item.id`, the timestamp-prefixed filename. It is a separate prop, not a field in the message file and not written into `render_props`. React: `<Banner {...item.render_props} nudge_id={item.id} />`. The Python `nudge_tracking` helper and the mobile nudge tracking wrapper receive `nudge_id` the same way. If `render_props` also contains `nudge_id`, the renderer's value wins. Renderers pass `render_props` through unchanged and never read `assets_base_url`. Components receive finished URLs.
- Fail closed when `component` is missing or unregistered: render nothing and log a warning.

It must also provide a per-framework helper. React: `useNudgeTracking(props.nudge_id)` returns `{ click, dismiss }`. Python server templates: `nudge_tracking(nudge_id)` returns the same pair. The mobile nudge tracking wrapper does too. Impression is not returned. The helper records it automatically once per `decide()` result. Re-renders and remounts do not count. That dedupe resets on each new `decide()` result.

The renderer takes `endpoint` (a developer-chosen URL) and the page's `context` once, for example `<NudgeHost endpoint="/api/nudges/events" context={{ organization_id: "acme" }} />` around the `decide()` result. Python `nudge_tracking` and the mobile nudge tracking wrapper take that same `endpoint` and `context` once. PLGKit never defines the route. Components do not pass organization ids.

`useNudgeTracking`, `nudge_tracking`, and the mobile nudge tracking wrapper POST JSON `{ nudge_id, action, context }` to that URL:

```json
{ "nudge_id": "...", "action": "impression|click|dismiss", "context": { "organization_id": "acme" } }
```

`context` is an optional flat map of page-level keys the front end knows. New keys can be added later without changing this shape. `user_id` always comes from the backend session and is never accepted from the browser. Ignore it if it is present in `context`. The backend verifies each context key before using it, and drops any key it cannot verify (fail closed). It then builds the flat event `{ user_id, ...verified context }` and calls the matching PLGKit function. A `dismiss_on_click` control calls `click`, then `dismiss`. A missing `user_id` fails closed: the event is ignored and never throws into the page.

```python
def record(body, session):
    context = body.get("context") or {}
    verified = {}
    org = context.get("organization_id")
    if org is not None and session.user_belongs_to(org):
        verified["organization_id"] = org  # otherwise drop it; drop any other unverified key too
    event = {"user_id": session.user_id, **verified}  # user_id from the session only
    {"impression": plgkit.impression, "click": plgkit.click, "dismiss": plgkit.dismiss}[body["action"]](
        body["nudge_id"], event
    )
```

React:

```jsx
const { click, dismiss } = useNudgeTracking(props.nudge_id);
```

The helper is optional. From your backend you may call `impression`, `dismiss`, and `click` yourself with an `event` of `user_id` from the session plus verified context. Then the once-per-`decide()`-result dedupe is your responsibility. Prefetches, discarded server renders, and slots that never mount must not burn `max_impressions`.
