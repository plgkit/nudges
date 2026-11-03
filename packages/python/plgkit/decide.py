"""Choose which messages to show. This only reads the events table."""

from __future__ import annotations

import re
from datetime import datetime, timezone

from plgkit.store import count_impressions, dismiss_contexts, get_default_db

_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_MAX_EXACT_INT = 2**53


def decide(location, ctx, messages, *, db=None, audiences=None, config=None, now=None):
    """Return the winners for one location.

    `messages` is the list you already loaded. Each item needs `id`,
    `location`, `surface`, `component`, and `render_props`. `ctx` is the
    same object you pass to audience functions. `user_id` is `ctx.user.id`.
    """
    if not isinstance(location, str) or location == "":
        return []
    if not messages:
        return []
    if db is None:
        db = get_default_db()
    moment = _as_utc(now)
    settings = config or {}
    locations = settings.get("locations") or {}
    if not isinstance(locations, dict):
        locations = {}
    loc = locations.get(location) or {}
    location_limit = _limit(loc, 1)
    surfaces_cfg = loc.get("surfaces") if isinstance(loc, dict) else None
    if not isinstance(surfaces_cfg, dict):
        surfaces_cfg = {}
    base = settings.get("assets_base_url") or ""
    if not isinstance(base, str):
        base = ""
    user_id = user_id_of(ctx)
    audience_fns = audiences or {}

    candidates = []
    for message in messages:
        if not _message_ok(message):
            continue
        if message.get("location") != location:
            continue
        if not _is_active(message, moment):
            continue
        if _is_dismissed(db, user_id, message, ctx):
            continue
        if not _under_max_impressions(db, user_id, message):
            continue
        if not _audience_matches(message, ctx, audience_fns):
            continue
        candidates.append(message)

    candidates.sort(key=lambda message: (_priority(message), message["id"]))

    winners = []
    per_surface = {}
    for message in candidates:
        if len(winners) >= location_limit:
            break
        surface = message["surface"]
        if per_surface.get(surface, 0) >= _limit(surfaces_cfg.get(surface), 1):
            continue
        winners.append(message)
        per_surface[surface] = per_surface.get(surface, 0) + 1

    return [
        {
            "id": message["id"],
            "surface": message["surface"],
            "component": message["component"],
            "render_props": resolve_assets(message["render_props"], base),
        }
        for message in winners
    ]


def user_id_of(ctx):
    user, ok = lookup(ctx, "user")
    if not ok:
        return ""
    user_id, ok = lookup(user, "id")
    if not ok or not isinstance(user_id, str):
        return ""
    return user_id


def lookup(obj, key):
    if isinstance(obj, dict):
        if key in obj:
            return obj[key], True
        return None, False
    if obj is None or isinstance(obj, (str, bytes, int, float, bool)):
        return None, False
    try:
        if hasattr(obj, key):
            return getattr(obj, key), True
    except Exception:
        return None, False
    return None, False


def resolve_assets(value, base):
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            if key == "asset" and isinstance(item, str):
                out[key] = join_asset(item, base)
            else:
                out[key] = resolve_assets(item, base)
        return out
    if isinstance(value, list):
        return [resolve_assets(item, base) for item in value]
    return value


def join_asset(asset, base):
    if asset.startswith(("http://", "https://", "/")):
        return asset
    if not base:
        return asset
    if not base.endswith("/"):
        base = base + "/"
    return base + asset


def _is_dismissed(db, user_id, message, ctx):
    """True when a dismiss row blocks this message.

    No dismiss_scope: any dismiss row for this user and nudge matches.
    With dismiss_scope: every listed key must be on ctx and on the row, with
    equal values. A row missing a scoped key does not match. If ctx is missing
    a scoped key, no row matches, so the message can show.
    """
    if not user_id:
        return False
    scope = message.get("dismiss_scope")
    rows = dismiss_contexts(db, user_id, message["id"])
    if scope is None:
        return len(rows) > 0
    ctx_values = {}
    for key in scope:
        value, ok = lookup(ctx, key)
        if not ok:
            return False
        ctx_values[key] = value
    for row in rows:
        if _row_matches_scope(row, scope, ctx_values):
            return True
    return False


def _row_matches_scope(row, scope, ctx_values):
    for key in scope:
        if key not in row:
            return False
        if not _same(row[key], ctx_values[key]):
            return False
    return True


def _under_max_impressions(db, user_id, message):
    if "max_impressions" not in message or message.get("max_impressions") is None:
        return True
    cap = _as_int(message.get("max_impressions"))
    if cap is None:
        return False
    if not user_id:
        return True
    return count_impressions(db, user_id, message["id"]) < cap


def _message_ok(message):
    if not isinstance(message, dict):
        return False
    if not isinstance(message.get("id"), str) or message.get("id") == "":
        return False
    if not isinstance(message.get("surface"), str) or message.get("surface") == "":
        return False
    if not isinstance(message.get("component"), str) or message.get("component") == "":
        return False
    if not isinstance(message.get("render_props"), dict):
        return False
    if "max_impressions" in message and message.get("max_impressions") is not None:
        cap = _as_int(message.get("max_impressions"))
        if cap is None or cap < 0:
            return False
    if "dismiss_scope" in message and message.get("dismiss_scope") is not None:
        scope = message.get("dismiss_scope")
        if not isinstance(scope, list) or not all(
            isinstance(key, str) and key != "" for key in scope
        ):
            return False
    if "priority" in message and message.get("priority") is not None:
        if _as_int(message.get("priority")) is None:
            return False
    active = message.get("active")
    if active is not None and not isinstance(active, dict):
        return False
    audience = message.get("audience")
    if audience is not None and not isinstance(audience, dict):
        return False
    return True


def _is_active(message, now):
    active = message.get("active")
    if active is None:
        return True
    if "from" in active and active.get("from") is not None:
        start = _parse_time(active.get("from"))
        if start is None or now < start:
            return False
    if "to" in active and active.get("to") is not None:
        end = _parse_time(active.get("to"))
        if end is None or now >= end:
            return False
    return True


def _audience_matches(message, ctx, audiences):
    spec = message.get("audience")
    if spec is None:
        return True
    require_all = _name_list(spec, "require_all")
    require_one = _name_list(spec, "require_one_of")
    exclude = _name_list(spec, "exclude")
    if require_all is None or require_one is None or exclude is None:
        return False
    listed = require_all + require_one + exclude
    checked = {name: _call_audience(audiences, name, ctx) for name in listed}
    if any(result is None for result in checked.values()):
        return False
    if any(checked[name] is not True for name in require_all):
        return False
    if "require_one_of" in spec and spec.get("require_one_of") is not None:
        if not any(checked[name] is True for name in require_one):
            return False
    if any(checked[name] is True for name in exclude):
        return False
    return True


def _name_list(spec, key):
    if key not in spec or spec.get(key) is None:
        return []
    names = spec.get(key)
    if not isinstance(names, list):
        return None
    if not all(isinstance(name, str) and name != "" for name in names):
        return None
    return names


def _call_audience(audiences, name, ctx):
    fn = audiences.get(name) if isinstance(audiences, dict) else None
    if not callable(fn):
        return None
    try:
        result = fn(ctx)
    except Exception:
        return None
    if result is True or result is False:
        return result
    return None


def _priority(message):
    if message.get("priority") is None:
        return 100
    return _as_int(message["priority"])


def _limit(container, default):
    if not isinstance(container, dict) or container.get("max") is None:
        return default
    number = _as_int(container.get("max"))
    if number is None or number < 0:
        return default
    return number


def _as_int(value):
    if isinstance(value, bool) or isinstance(value, str):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer() and abs(value) <= _MAX_EXACT_INT:
        return int(value)
    return None


def _parse_time(value):
    if not isinstance(value, str):
        return None
    text = value.strip()
    matched = _DATE.fullmatch(text)
    if matched:
        try:
            return datetime(
                int(matched.group(1)),
                int(matched.group(2)),
                int(matched.group(3)),
                tzinfo=timezone.utc,
            )
        except ValueError:
            return None
    iso = text[:-1] + "+00:00" if text.endswith(("Z", "z")) else text
    try:
        parsed = datetime.fromisoformat(iso)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _as_utc(now):
    if now is None:
        return datetime.now(timezone.utc)
    if now.tzinfo is None:
        return now.replace(tzinfo=timezone.utc)
    return now.astimezone(timezone.utc)


def _same(left, right):
    left_norm, left_ok = _norm(left)
    right_norm, right_ok = _norm(right)
    if not left_ok or not right_ok:
        return False
    return left_norm == right_norm


def _norm(value):
    if value is None or isinstance(value, str):
        return value, True
    if isinstance(value, bool):
        return value, True
    number = _as_int(value)
    if number is not None:
        return number, True
    if isinstance(value, float) and value == value and value not in (float("inf"), float("-inf")):
        return value, True
    return None, False
