# Messages

Name each message `YYYYMMDDHHMMSS-<slug>.yml`. The timestamp is UTC, in the style of a Rails migration. The slug is lowercase letters, numbers, and dashes. The filename without `.yml` is the message ID. The timestamp prefix makes reuse of a removed message's ID practically impossible.

Never rename or reuse an ID. Renaming makes a new message and resets dismissals and impressions.

CI should fail on duplicate IDs or on names without the prefix.

Developers never write the ID in YAML. It always comes from the filename.

## decide()

`decide(location, ctx)` returns a list of winners. The list is empty when nothing matches. [`../decide-response.json`](../decide-response.json) is a `home` call that returns the banner. That file is a JSON array. The banner is the only example message at `home`, so the list has one item.

Each item has `id` (the filename without `.yml`), `surface`, `component`, and `render_props`.

The host filters that list by `surface` and renders each slot. A renderer resolves `component`, passes `nudge_id` from the item `id`, and spreads `render_props`. It does not write `nudge_id` into `render_props`. The contract is in [the renderer contract](../../renderers.md).

`decide()` is read-only. It only reads impression counts to enforce `max_impressions`. It does not record them. `impression(nudge_id, event)`, `dismiss(nudge_id, event)`, and `click(nudge_id, event)` take a flat `event`, not the full `ctx`: `user_id` is required, plus any optional flat keys to record, for example `{"user_id": "u_123", "organization_id": "acme"}`. A missing `user_id` fails closed: the event is ignored and never throws into the page. `user_id` matches `ctx.user.id`. The renderer helper calls the developer's backend endpoint; that backend builds the `event` and calls PLGKit's `impression`, `click`, or `dismiss`. The helper still enforces one impression per message per `decide()` result. Re-renders and remounts do not count. A new `decide()` call can count again. Calling `impression` yourself makes dedupe your responsibility. `dismiss` is accepted for every nudge, with no per-message opt-in. A `dismissible` key inside `render_props` is presentation only: whether to show a close control. `click` records that a control was clicked. A `dismiss_on_click` control calls `click`, then `dismiss`.

## Limits and selection

Limits live in `plgkit/nudges/config.yml` (`location_limits` and `surface_limits`), not in message files, so messages cannot disagree about a page's cap. A location or surface that is not listed defaults to 1.

```python
def decide(location, ctx):
    location_limit = location_limits.get(location, 1)
    candidates = [
        m for m in messages
        if m.location == location
        and m.surface and m.component and m.render_props is not None  # missing required fields fail closed; {} is valid
        and is_active(m, now_utc)  # UTC midnight if date-only; from inclusive; to exclusive; missing from = now; missing to = forever
        and not dismissed(ctx, m)  # omitted dismiss_scope = any dismissal for this user_id; else those keys must match ctx
        and under_max_impressions(ctx, m)  # count impression events for this user_id; missing max = unlimited
        and audience_matches(m, ctx)  # omitted audience = everyone
    ]
    candidates.sort(key=lambda m: (m.priority if m.priority is not None else 100, m.id))
    winners = []
    per_surface = {}
    for m in candidates:
        if len(winners) >= location_limit:
            break  # location is full; stop
        surface_limit = surface_limits.get(m.surface, 1)
        if per_surface.get(m.surface, 0) >= surface_limit:
            continue  # only this surface is full; skip and continue
        winners.append(m)
        per_surface[m.surface] = per_surface.get(m.surface, 0) + 1
    return [
        {
            "id": m.id,
            "surface": m.surface,
            "component": m.component,
            "render_props": resolve_assets(m.render_props, assets_base_url),
        }
        for m in winners
    ]
```

Invalid or missing required fields fail closed: the message is skipped, and the page does not crash. Missing `priority` sorts as 100.

Worked example. One page, location limit 2, `main-top` limit 2, `sidebar` limit 1. Four messages that already match, in sort order. A and B are `main-top`. C and D are `sidebar`. A–D are not files in this folder, and `sidebar` is not one of the example surfaces.

- Take A (location 0/2, `main-top` 0/2).
- Take B (location 1/2, `main-top` 1/2).
- The location limit is now reached, so selection stops. C is skipped even though `sidebar` still had room (0/1). D is not considered.

Result: `[A, B]`.

## Renderers

`component` is a universal name, never a framework path. Renderers are separate packages. The contract, including the registry, fail-closed rendering, and the `useNudge` helper, is in [spec/renderers.md](../../renderers.md).

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

Invalid or missing required fields fail closed. The message is skipped and never crashes the page.

| Field | Required? | Default | Read by | Notes |
| --- | --- | --- | --- | --- |
| `location` | Yes | — | Engine | Missing = fail closed: the message is never returned or rendered. Argument to `decide(location, ctx)`. Not on each result item. Cap is `location_limits` in config; unlisted locations default to 1. Examples: `home`, `get-started`. |
| `surface` | Yes | — | Engine | Missing = fail closed. On each result item. The host filters by it to render each slot. Not merged into component props. Cap is `surface_limits` in config; unlisted surfaces default to 1. Examples: `main-top`, `modal`. |
| `component` | Yes | — | Renderer | Universal name, never a framework path. Examples: `Banner`, `OnboardingModal`. The renderer registry maps it to a real component, template, or view. Missing or unregistered = fail closed: render nothing, and the renderer logs a warning. CI can flag unregistered names. Not merged into component props. See [the renderer contract](../../renderers.md). |
| `active.from` | No | Active immediately | Engine | UTC. A date with no time is midnight UTC. Inclusive at that exact instant. |
| `active.to` | No | Live forever | Engine | UTC. A date with no time is midnight UTC. Exclusive at that exact instant. The modal omits it. |
| `priority` | No | 100 | Engine | Lower numbers win. Ties go to the older filename (`id` ascending). |
| `max_impressions` | No | Unlimited | Engine and renderer | The count is `impression(nudge_id, event)` calls for this `user_id`. At most one per message per `decide()` result. Re-renders and remounts do not count again. A new `decide()` call can. The renderer helper enforces that dedupe. A direct call makes dedupe the caller's job. `decide()` only reads the count; a message at the cap is not a candidate. |
| `dismiss_scope` | No | Everywhere for that user | Engine | Flat list of event/ctx keys, for example `[organization_id]`. Omitted means a dismissal for that `user_id` applies everywhere. When set, `decide()` treats the message as dismissed only if a dismissal for that user has the same values for those keys. A dismiss event missing a scoped key is ignored (fail closed). If ctx is missing a key listed in dismiss_scope, no dismissal matches, so the message can show. This is intentional (e.g. a page outside any organization). The modal sets `[organization_id]`. |
| `audience` | No | Everyone matches | Engine | Omitted entirely means everyone matches. |
| `audience.require_all` | No | Check passes | Engine | All named functions must be true. Omitted means this check passes. |
| `audience.require_one_of` | No | Check passes | Engine | At least one must be true. Omitted means this check passes. The modal omits it. |
| `audience.exclude` | No | Excludes no one | Engine | Any true name excludes the message. Omitted excludes no one. The modal omits it. |
| `render_props` | Yes | — | Renderer | Nothing renders without it. Missing = fail closed. `{}` is valid. Opaque to the core except `asset`: `decide()` joins a relative `asset` with `assets_base_url`, and leaves values that are `http://`, `https://`, or start with `/` as is. Passed through as the component props, next to a separate `nudge_id`. `nudge_id` is not written into `render_props`. If this object also has `nudge_id`, the renderer's value wins. A `dismissible` value here is presentation only and does not gate `dismiss(nudge_id, event)`. `dismiss_on_click` means that control calls `click`, then `dismiss`, for this nudge. |
