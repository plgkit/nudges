# Messages

Name each message `YYYYMMDDHHMMSS-<slug>.yml`. The timestamp is UTC, in the style of a Rails migration. The slug is lowercase letters, numbers, and dashes. The filename without `.yml` is the message ID. The timestamp prefix makes reuse of a removed message's ID practically impossible.

Never rename or reuse an ID. Renaming makes a new message and resets dismissals and impressions.

CI should fail on duplicate IDs or on names without the prefix.

Developers never write the ID in YAML. It always comes from the filename.

## decide()

`decide()` returns one message, or `null` when nothing matches. [`../decide-response.json`](../decide-response.json) is the match for `20261030183743-home-supersuit-launch-banner`. The `null` result is not in that file.

The result carries `id` (the filename without `.yml`), `surface`, `dismissible`, and `render_props`.

The wrapper merges `id` and `dismissible` into the component's props alongside `render_props`. It passes `id`, `dismissible`, and every field inside `render_props` as the component's own props. A dumb component can render the close X when `dismissible` is true and call `dismiss(id)` or `onDismiss(id)`. `surface` stays on the `decide()` result so the host knows where to mount the component. The wrapper does not merge `surface` into those props.

## App layout

Day-one languages are Python (the default), Go, and TypeScript. In your app, messages live at `plgkit/nudges/messages/`. Audiences live at `plgkit/nudges/audiences.py`, `plgkit/nudges/audiences.go`, or `plgkit/nudges/audiences.ts`.

```
plgkit/nudges/
  messages/
  audiences.py
  config.yml
```

Use `audiences.go` in a Go app and `audiences.ts` in a TypeScript app, instead of `audiences.py`. `config.yml` is Nudges-only. A shared `plgkit/config.yml` is only for cross-product settings, such as a hosted API key, and is not included here. `plgkit/` is the umbrella folder. Other PLGKit products get sibling folders next to `nudges/`. Personas will live in `plgkit/personas/`.

## Fields

| Field | Required? | Default | Read by | Notes |
| --- | --- | --- | --- | --- |
| `location` | TBD | TBD | Engine | Not returned by `decide()`. Examples: `home`, `get-started`. |
| `surface` | TBD | TBD | Engine | Returned by `decide()` so the host knows where to mount. Not merged into component props. Examples: `main-top`, `modal`. |
| `active.from` | TBD | TBD | Engine | UTC. Midnight if the value has no time. Whether the field may be omitted is not stated. |
| `active.to` | No | No end | Engine | UTC. Midnight if the value has no time. Omitting it means the message does not end. The modal omits it. |
| `priority` | TBD | TBD | Engine | Lower numbers win. Ties go to the filename that sorts first, which is the older message. |
| `dismissible` | TBD | TBD | Engine and renderer | The engine records dismissals. `decide()` returns it next to `render_props`. The wrapper merges it into component props so the component can show a close button and call `dismiss(id)` or `onDismiss(id)`. |
| `max_impressions` | No | Unlimited | Engine | Leaving it out means unlimited. |
| `audience.require_all` | TBD | TBD | Engine | Audience function names that must all be true. Both examples set it. The default when omitted is not stated. |
| `audience.require_one_of` | No | TBD | Engine | At least one must be true. The modal omits it. The default when omitted is not stated. |
| `audience.exclude` | No | TBD | Engine | Any true name excludes the message. The modal omits it. The default when omitted is not stated. |
| `render_props` | TBD | TBD | Renderer | Opaque to the core and passed through. The wrapper spreads these fields onto the component and adds `id` and `dismissible`. |
