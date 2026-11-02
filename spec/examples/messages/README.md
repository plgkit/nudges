# Messages

Name each message `YYYYMMDDHHMMSS-<slug>.yml`. The timestamp is UTC, in the style of a Rails migration. The slug is lowercase letters, numbers, and dashes. The filename without `.yml` is the message ID. The timestamp prefix makes reuse of a removed message's ID practically impossible.

Never rename or reuse an ID. Renaming makes a new message and resets dismissals and impressions.

CI should fail on duplicate IDs or on names without the prefix.

Developers never write the ID in YAML. It always comes from the filename.

## decide()

`decide(location, ctx)` returns a list of winners. The list is empty when nothing matches. [`../decide-response.json`](../decide-response.json) is a `home` call that returns the banner. That file is a JSON array. The banner is the only example message at `home`, so the list has one item.

Each item has `id` (the filename without `.yml`), `surface`, `dismissible`, and `render_props`.

The host filters that list by `surface` and renders each slot. For each item, the wrapper merges `id`, `dismissible`, `onImpression`, and `onDismiss` into the component's props alongside `render_props`. A dumb component never wires this itself. The wrapper does not merge `surface` into those props.

`decide()` is read-only. It only reads impression counts to enforce `max_impressions`. It does not record them. When the component actually mounts or becomes visible, the wrapper calls `onImpression` once, and that calls `impression(id)`, mirroring `onDismiss` calling `dismiss(id)`. The close control calls `onDismiss`. The component does not wire either call. Prefetches, discarded server renders, and slots that never mount must not burn `max_impressions`.

## Limits and selection

Limits live in `plgkit/nudges/config.yml` (`location_limits` and `surface_limits`), not in message files, so messages cannot disagree about a page's cap. A location or surface that is not listed defaults to 1.

```python
def decide(location, ctx):
    location_limit = location_limits.get(location, 1)
    candidates = [
        m for m in messages
        if m.location == location
        and is_active(m, now_utc)  # UTC; a date with no time is midnight
        and not dismissed(ctx.user, m.id)
        and under_max_impressions(ctx.user, m)  # read the count only; missing = unlimited
        and audience_matches(m, ctx)
    ]
    candidates.sort(key=lambda m: (m.priority, m.id))  # lower priority, then older id
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
            "dismissible": m.dismissible,
            "render_props": m.render_props,
        }
        for m in winners
    ]
```

Both example messages set `priority`. The sort above uses it. What to do when `priority` is missing is still TBD.

Worked example. One page, location limit 2, `main-top` limit 2, `sidebar` limit 1. Four messages that already match, in sort order. A and B are `main-top`. C and D are `sidebar`. A–D are not files in this folder, and `sidebar` is not one of the example surfaces.

- Take A (location 0/2, `main-top` 0/2).
- Take B (location 1/2, `main-top` 1/2).
- The location limit is now reached, so selection stops. C is skipped even though `sidebar` still had room (0/1). D is not considered.

Result: `[A, B]`.

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
| `location` | TBD | TBD | Engine | Argument to `decide(location, ctx)`. Not on each result item. Cap is `location_limits` in config; unlisted locations default to 1. Examples: `home`, `get-started`. |
| `surface` | TBD | TBD | Engine | On each result item. The host filters by it to render each slot. Not merged into component props. Cap is `surface_limits` in config; unlisted surfaces default to 1. Examples: `main-top`, `modal`. |
| `active.from` | TBD | TBD | Engine | UTC. Midnight if the value has no time. Whether the field may be omitted is not stated. |
| `active.to` | No | No end | Engine | UTC. Midnight if the value has no time. Omitting it means the message does not end. The modal omits it. |
| `priority` | TBD | TBD | Engine | Sort key is `priority` ascending, then `id` ascending. Lower numbers win. The id that sorts first is the older filename. |
| `dismissible` | TBD | TBD | Engine and renderer | The engine records dismissals. Each `decide()` item includes it next to `render_props`. The wrapper passes `onDismiss`, which calls `dismiss(id)`. The component does not wire that itself. |
| `max_impressions` | No | Unlimited | Engine and renderer | Leaving it out means unlimited. The count is impressions the renderer reported with `impression(id)`. `decide()` only reads that count; a message at the cap is not a candidate. |
| `audience.require_all` | TBD | TBD | Engine | Audience function names that must all be true. Both examples set it. The default when omitted is not stated. |
| `audience.require_one_of` | No | TBD | Engine | At least one must be true. The modal omits it. The default when omitted is not stated. |
| `audience.exclude` | No | TBD | Engine | Any true name excludes the message. The modal omits it. The default when omitted is not stated. |
| `render_props` | TBD | TBD | Renderer | Opaque to the core and passed through on each item. The wrapper spreads these fields onto the component and adds `id`, `dismissible`, `onImpression`, and `onDismiss`. |
