# Messages

Name each message `YYYYMMDDHHMMSS-<slug>.yml`. The timestamp is UTC, in the style of a Rails migration. The slug is lowercase letters, numbers, and dashes. The filename without `.yml` is the message ID. The timestamp prefix makes reuse of a removed message's ID practically impossible.

Never rename or reuse an ID. Renaming makes a new message and resets dismissals and impressions.

CI should fail on duplicate IDs or on names without the prefix.

Developers never write the ID in YAML. It always comes from the filename.

## decide()

`decide(location, ctx)` returns a list of winners. The list is empty when nothing matches. [`../decide-response.json`](../decide-response.json) is a `home` call that returns the banner. That file is a JSON array. The banner is the only example message at `home`, so the list has one item.

Each item has `id` (the filename without `.yml`), `surface`, `component`, and `render_props`.

The host filters that list by `surface` and renders each slot. The wrapper looks up `component` in its registry and passes `render_props` as the component's props. It does not merge anything into those props.

`decide()` is read-only. It only reads impression counts to enforce `max_impressions`. It does not record them. The developer calls `impression(id)` once when the message is shown, using the `id` on the `decide()` item. Re-renders and remounts do not count as a second impression. A new page view (a new `decide()` call, such as navigation or reload) can count again. Prefetches, discarded server renders, and slots that never mount must not burn `max_impressions`. The developer calls `dismiss(id)` the same way. The backend accepts that for every nudge, with no per-message opt-in. A `dismissible` key inside `render_props` is presentation only: the renderer uses it to decide whether to show a close control.

**Open question:** who enforces the once-per-page-view dedupe now that the developer calls `impression(id)` directly?

## Limits and selection

Limits live in `plgkit/nudges/config.yml` (`location_limits` and `surface_limits`), not in message files, so messages cannot disagree about a page's cap. A location or surface that is not listed defaults to 1.

```python
def decide(location, ctx):
    location_limit = location_limits.get(location, 1)
    candidates = [
        m for m in messages
        if m.location == location
        and m.surface and m.component and m.render_props is not None  # missing required fields fail closed; {} is valid
        and is_active(m, now_utc)  # missing from = now; missing to = forever; to is exclusive; date-only = midnight UTC
        and not dismissed(ctx.user, m.id)
        and under_max_impressions(ctx.user, m)  # read the count only; missing = unlimited
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
            "render_props": m.render_props,
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

## Component registry

`component` is a universal name, never a framework path. Each wrapper keeps a registry from that name to the real component: a React component, a server template, or a mobile view. It passes `render_props` through as the props and injects nothing.

```python
registry = {
    "Banner": Banner,
    "OnboardingModal": OnboardingModal,
}

def render(item):
    Component = registry.get(item.get("component"))
    if Component is None or item.get("render_props") is None:
        log.warning("nudges: missing or unregistered component for %s", item.get("id"))
        return None  # fail closed: render nothing
    return Component(**item["render_props"])
```

The developer calls `impression(item["id"])` once when the message is shown, and `dismiss(item["id"])` when it is dismissed. Both use the `id` on the `decide()` item. `dismiss(id)` is accepted for every nudge.

A missing or unregistered name renders nothing. The wrapper logs a warning. A CI check can flag names that are not in the registry.

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
| `component` | Yes | — | Renderer (wrapper) | Universal name, never a framework path. Examples: `Banner`, `OnboardingModal`. The wrapper registry maps it to the real component. Missing or unregistered = fail closed: render nothing, and the wrapper logs a warning. CI can flag unregistered names. Not merged into component props. |
| `active.from` | No | Active immediately | Engine | UTC. A date with no time is midnight UTC. |
| `active.to` | No | Live forever | Engine | UTC. A date with no time is midnight UTC. Exclusive at that exact instant. The modal omits it. |
| `priority` | No | 100 | Engine | Lower numbers win. Ties go to the older filename (`id` ascending). |
| `max_impressions` | No | Unlimited | Engine and renderer | The count is impressions the developer reported with `impression(id)`. At most one per message per page view (one `decide()` result). Re-renders and remounts do not count again. A new `decide()` call can. Who enforces that dedupe is the open question under `decide()`. `decide()` only reads the count; a message at the cap is not a candidate. |
| `audience` | No | Everyone matches | Engine | Omitted entirely means everyone matches. |
| `audience.require_all` | No | Check passes | Engine | All named functions must be true. Omitted means this check passes. |
| `audience.require_one_of` | No | Check passes | Engine | At least one must be true. Omitted means this check passes. The modal omits it. |
| `audience.exclude` | No | Excludes no one | Engine | Any true name excludes the message. Omitted excludes no one. The modal omits it. |
| `render_props` | Yes | — | Renderer | Nothing renders without it. Missing = fail closed. `{}` is valid. Opaque to the core and passed through as the component props. The wrapper adds no keys. A `dismissible` value here is presentation only and does not gate `dismiss(id)`. |
