"""`plgkit migrate` creates the events table."""

import sys

from plgkit.store import PlgkitError, migrate


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    if not args or args[0] in ("-h", "--help"):
        print("Usage: plgkit migrate", file=sys.stderr)
        raise SystemExit(0 if args else 1)
    if args[0] != "migrate":
        print(f"Unknown command: {args[0]}", file=sys.stderr)
        print("Usage: plgkit migrate", file=sys.stderr)
        raise SystemExit(1)
    try:
        migrate()
    except PlgkitError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from exc
    print("Migrations are up to date.")
    raise SystemExit(0)
