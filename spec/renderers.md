# Renderer contract

A renderer is a separate importable package. It is not a core plugin. Anyone can publish one against this contract. PLGKit ships a few in the nudges repo. React is first. Server templates and mobile come later.

A renderer must:

- Keep a registry from the `component` string to a real component, template, or view.
- Render the matching `decide()` item by passing `nudge_id` and `render_props`. The item shape is `{ id, surface, component, render_props }`. `nudge_id` is `item.id`, the timestamp-prefixed filename. It is a separate prop, not a field in the message file and not written into `render_props`. React: `<Banner {...item.render_props} nudge_id={item.id} />`. A Python template helper and a mobile view wrapper receive `nudge_id` the same way. If `render_props` also contains `nudge_id`, the renderer's value wins.
- Fail closed when `component` is missing or unregistered: render nothing and log a warning.

It must also provide a per-framework helper. The helper exposes `dismiss()` and records at most one impression per message per page view. Re-renders and remounts do not count. A new `decide()` call, such as navigation or reload, can count again. The helper enforces that dedupe.

The helper takes `nudge_id`. React:

```jsx
const { dismiss } = useNudge(props.nudge_id);
```

On the first mount for this page view, `useNudge` calls `impression(id)` once. `dismiss()` calls `dismiss(id)`. The backend accepts `dismiss(id)` for every nudge.

The helper is optional. Call `dismiss(id)` and `impression(id)` yourself if you prefer. Then the once-per-page-view dedupe is your responsibility. Prefetches, discarded server renders, and slots that never mount must not burn `max_impressions`.
