# Renderer contract

A renderer is a separate importable package. It is not a core plugin. Anyone can publish one against this contract. PLGKit ships a few in the nudges repo. React is first. Server templates and mobile come later.

A renderer must:

- Keep a registry from the `component` string to a real component, template, or view.
- Render the matching `decide()` item by passing `nudge_id` and `render_props`. The item shape is `{ id, surface, component, render_props }`. `nudge_id` is `item.id`, the timestamp-prefixed filename. It is a separate prop, not a field in the message file and not written into `render_props`. React: `<Banner {...item.render_props} nudge_id={item.id} />`. A Python template helper and a mobile view wrapper receive `nudge_id` the same way. If `render_props` also contains `nudge_id`, the renderer's value wins. Renderers pass `render_props` through unchanged and never read `assets_base_url`. Components receive finished URLs.
- Fail closed when `component` is missing or unregistered: render nothing and log a warning.

It must also provide a per-framework helper. The helper exposes `dismiss()` and records at most one impression per message per `decide()` result (one page view). Re-renders and remounts do not count. The `useNudge` dedupe resets on each new `decide()` result, so that call can count again. The helper enforces that dedupe.

The helper takes `nudge_id`. React:

```jsx
const { dismiss } = useNudge(props.nudge_id);
```

On the first mount for this `decide()` result, `useNudge` records one impression. `dismiss()` records a dismissal. Both go to the developer's backend with only `nudge_id`. The browser must not be trusted to set `user_id`. The developer's backend builds the flat `event` from its own session and calls `impression(nudge_id, event)` or `dismiss(nudge_id, event)`. `click(nudge_id, event)` is the same path. A `dismiss_on_click` control calls `click`, then `dismiss`. A missing `user_id` fails closed: the event is ignored and never throws into the page.

The helper is optional. From your backend you may call `impression`, `dismiss`, and `click` yourself with an `event` built from the session. Then the once-per-`decide()`-result dedupe is your responsibility. Prefetches, discarded server renders, and slots that never mount must not burn `max_impressions`.
