"""Check a posted event and append one row.

`handle_event(body, user_id, verify)` is framework-agnostic. `body` is already
parsed JSON: `{nudge_id, action, context}`. `user_id` comes from the session.
Any `user_id` inside `context` is ignored. `verify` maps a context key to
`function(user_id, value) -> bool`. Keys with no function, or a function that
is not true, are dropped.
"""

import sys

from plgkit.store import canon, click, dismiss, impression

_ACTIONS = {
    "impression": impression,
    "click": click,
    "dismiss": dismiss,
}


def handle_event(body, user_id, verify=None, db=None):
    """Return 204 when the body is acceptable, 400 when it is not.

    A missing session user id returns 204 and writes nothing. A database
    failure returns 500.
    """
    parsed, status = _parse_body(body)
    if status != 204:
        return status
    nudge_id, action, context = parsed
    if verify is None:
        verify = {}
    elif not isinstance(verify, dict):
        return 500
    if not isinstance(user_id, str) or user_id == "":
        return 204
    verified = {}
    for key in sorted(context):
        fn = verify.get(key)
        if not callable(fn):
            continue
        try:
            ok = fn(user_id, context[key])
        except Exception:
            ok = False
        if ok is True:
            verified[key] = context[key]
    try:
        _ACTIONS[action](nudge_id, {"user_id": user_id, **verified}, db)
    except Exception:
        print("plgkit: could not save the event.", file=sys.stderr)
        return 500
    return 204


def _parse_body(body):
    if not isinstance(body, dict):
        return None, 400
    nudge_id = body.get("nudge_id")
    action = body.get("action")
    if not isinstance(nudge_id, str) or nudge_id == "":
        return None, 400
    if action not in _ACTIONS:
        return None, 400
    raw_context = body.get("context", None)
    if raw_context is None:
        raw_context = {}
    elif not isinstance(raw_context, dict):
        return None, 400
    context = {}
    for key, value in raw_context.items():
        if key == "user_id":
            continue
        if not isinstance(key, str):
            return None, 400
        cleaned, ok = canon(value)
        if not ok:
            return None, 400
        context[key] = cleaned
    return (nudge_id, action, context), 204
