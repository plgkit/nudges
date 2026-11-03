"""`plgkit migrate` creates the events table. `plgkit undismiss` is a dev-only CLI."""

import sys

from plgkit.store import PlgkitError, migrate, undismiss


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    if not args or args[0] in ("-h", "--help"):
        _usage()
        raise SystemExit(0 if args else 1)
    if args[0] == "migrate":
        _migrate()
    elif args[0] == "undismiss":
        _undismiss(args[1:])
    else:
        print(f"Unknown command: {args[0]}", file=sys.stderr)
        _usage()
        raise SystemExit(1)


def _usage():
    print("Usage: plgkit migrate", file=sys.stderr)
    print("       plgkit undismiss <nudge_id> --user <user_id>", file=sys.stderr)


def _migrate():
    try:
        migrate()
    except PlgkitError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from exc
    print("Migrations are up to date.")
    raise SystemExit(0)


def _undismiss(args):
    if len(args) < 1:
        _usage()
        raise SystemExit(1)
    nudge_id = args[0]
    user_id = None
    index = 1
    while index < len(args):
        token = args[index]
        if token == "--user":
            if index + 1 >= len(args):
                print("Missing value for --user.", file=sys.stderr)
                raise SystemExit(1)
            user_id = args[index + 1]
            index += 2
            continue
        print(f"Unknown argument: {token}", file=sys.stderr)
        _usage()
        raise SystemExit(1)
    if not isinstance(nudge_id, str) or nudge_id == "":
        _usage()
        raise SystemExit(1)
    if not isinstance(user_id, str) or user_id == "":
        print("--user is required.", file=sys.stderr)
        raise SystemExit(1)
    try:
        undismiss(nudge_id, {"user_id": user_id})
    except PlgkitError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from exc
    raise SystemExit(0)
