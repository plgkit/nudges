# Renderer contract

A renderer is a separate importable package. It is not a core plugin. Anyone can publish one against this contract. PLGKit ships a few in the nudges repo. React is first. Server templates and mobile come later.

A renderer must:

- Keep a registry from the `component` string to a real component, template, or view.
- Render the matching `decide()` item by passing `nudge_id` and `render_props`. The item shape is `{ id, surface, component, render_props }`. `nudge_id` is `item.id`, the timestamp-prefixed filename. It is a separate prop, not a field in the message file and not written into `render_props`. React: `<Banner {...item.render_props} nudge_id={item.id} />`. The Python `nudge_tracking` helper and the mobile nudge tracking wrapper receive `nudge_id` the same way. If `render_props` also contains `nudge_id`, the renderer's value wins. Renderers pass `render_props` through unchanged and never read `assets_base_url`. Components receive finished URLs.
- Fail closed when `component` is missing or unregistered: render nothing and log a warning.

It must also provide a per-framework helper. React: `useNudgeTracking(props.nudge_id)` returns `{ click, dismiss }`. Python server templates: `nudge_tracking(nudge_id)` returns the same pair. The mobile nudge tracking wrapper does too. Impression is not returned. The helper records it automatically once per `decide()` result. Re-renders and remounts do not count. That dedupe resets on each new `decide()` result.

Every helper call goes to one developer backend endpoint and sends `{ nudge_id, action }`, where `action` is `impression`, `click`, or `dismiss`. The browser must not be trusted to set `user_id`. The developer's backend builds the flat `event` from its own session and calls the matching PLGKit function. A `dismiss_on_click` control calls `click`, then `dismiss`. A missing `user_id` fails closed: the event is ignored and never throws into the page.

React:

```jsx
const { click, dismiss } = useNudgeTracking(props.nudge_id);
```

The helper is optional. From your backend you may call `impression`, `dismiss`, and `click` yourself with an `event` built from the session. Then the once-per-`decide()`-result dedupe is your responsibility. Prefetches, discarded server renders, and slots that never mount must not burn `max_impressions`.
