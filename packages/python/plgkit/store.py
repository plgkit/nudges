"""Open the database, run migrations, and append event rows.

The database address lives in an environment variable named by
`database_url_env` in config.yml. The address can contain a password, so it
is never written into config. If that variable is unset, we use a SQLite
file, `plgkit_events.sqlite`, in the current directory.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_DATABASE_URL_ENV = "PLGKIT_DATABASE_URL"
DEFAULT_DATABASE_URL = "sqlite:///plgkit_events.sqlite"
_ENV_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_MIGRATION_NAME = re.compile(r"^(\d+)_.+\.sql$")
_MAX_EXACT_INT = 2**53

_lock = threading.RLock()
_default_db = None
_warned_default = False


class PlgkitError(Exception):
    """A problem the developer should read, such as a bad database setting."""


def resolve_database_url(config_path=None, environ=None):
    """Return `(url, used_default)`.

    `used_default` is true when the env var was unset and the URL is the
    local SQLite file. The URL from the environment is returned as-is only
    when it is a SQLite URL. Other schemes raise PlgkitError. The error text
    never includes the URL, because it can contain a password.
    """
    env = os.environ if environ is None else environ
    name = _env_var_name(config_path)
    value = env.get(name, "")
    if not isinstance(value, str):
        value = ""
    value = value.strip()
    if not value:
        return DEFAULT_DATABASE_URL, True
    if value.startswith("sqlite:"):
        return value, False
    scheme = value.split("://", 1)[0] if "://" in value else "unknown"
    raise PlgkitError(
        f"{name} uses the {scheme!r} scheme. "
        "This version of plgkit supports SQLite only, for example "
        "sqlite:///plgkit_events.sqlite. "
        "Unset the variable to use the local SQLite file."
    )


def connect(url=None):
    """Open a SQLite connection. `url=None` reads config and the environment."""
    if url is None:
        url, used_default = resolve_database_url()
        if used_default:
            _warn_default(_env_var_name(None))
    path = _sqlite_path(url)
    try:
        conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
    except sqlite3.Error as exc:
        raise PlgkitError("Could not open the SQLite database.") from exc
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def migrate(db=None, migrations_dir=None):
    """Create the events table. Safe to run again; new files are applied once."""
    if db is None:
        db = get_default_db()
    directory = Path(migrations_dir) if migrations_dir else find_migrations_dir()
    with _lock:
        db.execute(
            "CREATE TABLE IF NOT EXISTS plgkit_schema_migrations (version TEXT PRIMARY KEY)"
        )
        applied = {
            row[0]
            for row in db.execute("SELECT version FROM plgkit_schema_migrations")
        }
        for version, path in _migration_files(directory):
            if version in applied:
                continue
            statements = _sql_statements(path.read_text(encoding="utf-8"))
            db.execute("BEGIN")
            try:
                for statement in statements:
                    db.execute(statement)
                db.execute(
                    "INSERT INTO plgkit_schema_migrations (version) VALUES (?)",
                    (version,),
                )
                db.execute("COMMIT")
            except sqlite3.Error as exc:
                db.execute("ROLLBACK")
                raise PlgkitError(f"Migration {version} failed.") from exc
    return db


def get_default_db():
    global _default_db
    with _lock:
        if _default_db is None:
            _default_db = connect(None)
        return _default_db


def set_default_db(db):
    """Tests and apps can pin the connection the handlers use."""
    global _default_db
    with _lock:
        _default_db = db


def impression(nudge_id, event, db=None):
    _record("impression", nudge_id, event, db)


def click(nudge_id, event, db=None):
    _record("click", nudge_id, event, db)


def dismiss(nudge_id, event, db=None):
    _record("dismiss", nudge_id, event, db)


def count_impressions(db, user_id, nudge_id):
    with _lock:
        row = db.execute(
            "SELECT COUNT(*) FROM plgkit_events "
            "WHERE user_id = ? AND nudge_id = ? AND action = 'impression'",
            (user_id, nudge_id),
        ).fetchone()
    return int(row[0])


def dismiss_contexts(db, user_id, nudge_id):
    with _lock:
        rows = db.execute(
            "SELECT context FROM plgkit_events "
            "WHERE user_id = ? AND nudge_id = ? AND action = 'dismiss'",
            (user_id, nudge_id),
        ).fetchall()
    found = []
    for (raw,) in rows:
        try:
            data = json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            continue
        if isinstance(data, dict):
            found.append(data)
    return found


def find_migrations_dir():
    override = os.environ.get("PLGKIT_MIGRATIONS_DIR", "").strip()
    if override:
        path = Path(override)
        if path.is_dir():
            return path
        raise PlgkitError(
            "PLGKIT_MIGRATIONS_DIR is set, but that folder does not exist."
        )
    starts = [Path(__file__).resolve().parent, Path.cwd()]
    seen = set()
    for start in starts:
        current = start
        while current not in seen:
            seen.add(current)
            candidate = current / "core" / "migrations"
            if candidate.is_dir():
                return candidate
            if current.parent == current:
                break
            current = current.parent
    raise PlgkitError(
        "Could not find the plgkit migrations folder (core/migrations). "
        "Run this from the nudges repo, or set PLGKIT_MIGRATIONS_DIR."
    )


def _record(action, nudge_id, event, db):
    if not isinstance(nudge_id, str) or nudge_id == "":
        return
    if not isinstance(event, dict):
        return
    user_id = event.get("user_id")
    if not isinstance(user_id, str) or user_id == "":
        return
    context = {}
    for key, value in event.items():
        if key == "user_id" or not isinstance(key, str):
            continue
        cleaned, ok = canon(value)
        if ok:
            context[key] = cleaned
    if db is None:
        db = get_default_db()
    with _lock:
        db.execute(
            "INSERT INTO plgkit_events "
            "(id, nudge_id, action, user_id, context, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                str(uuid.uuid4()),
                nudge_id,
                action,
                user_id,
                json.dumps(context, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
            ),
        )


def canon(value):
    """Return `(normalized, True)` for a flat JSON value, else `(None, False)`."""
    if value is None or isinstance(value, str):
        return value, True
    if isinstance(value, bool):
        return value, True
    if isinstance(value, int):
        return value, True
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            return None, False
        if value.is_integer() and abs(value) <= _MAX_EXACT_INT:
            return int(value), True
        return value, True
    return None, False


def _env_var_name(config_path):
    path = config_path
    if path is None:
        candidate = Path.cwd() / "plgkit" / "nudges" / "config.yml"
        if candidate.is_file():
            path = candidate
    if path is None:
        return DEFAULT_DATABASE_URL_ENV
    try:
        text = Path(path).read_text(encoding="utf-8")
    except OSError as exc:
        raise PlgkitError(f"Could not read config file: {path}") from exc
    name = _parse_database_url_env(text)
    if name is None:
        return DEFAULT_DATABASE_URL_ENV
    if not _ENV_NAME.fullmatch(name):
        raise PlgkitError(
            "database_url_env in config.yml must be the name of an environment "
            "variable, not the database address. The address can contain a "
            "password, so put it in the environment. "
            "Example: database_url_env: PLGKIT_DATABASE_URL"
        )
    return name


def _parse_database_url_env(text):
    found = []
    for raw in text.splitlines():
        if raw.startswith((" ", "\t")):
            continue
        line = raw.split("#", 1)[0].strip()
        if not line.startswith("database_url_env:"):
            continue
        value = line.split(":", 1)[1].strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        found.append(value)
    if not found:
        return None
    if len(found) > 1:
        raise PlgkitError("database_url_env is set more than once in config.yml.")
    return found[0]


def _sqlite_path(url):
    if not isinstance(url, str) or not url.startswith("sqlite:"):
        raise PlgkitError(
            "This version of plgkit supports SQLite only, for example "
            "sqlite:///plgkit_events.sqlite."
        )
    if url == "sqlite:///:memory:" or url == "sqlite::memory:":
        return ":memory:"
    prefix = "sqlite:///"
    if not url.startswith(prefix):
        raise PlgkitError(
            "The SQLite URL must look like sqlite:///plgkit_events.sqlite "
            "or sqlite:///:memory:."
        )
    return url[len(prefix) :]


def _migration_files(directory):
    if not directory.is_dir():
        raise PlgkitError(f"Migrations folder does not exist: {directory}")
    found = []
    for path in directory.glob("*.sql"):
        match = _MIGRATION_NAME.match(path.name)
        if match:
            found.append((match.group(1), path))
    found.sort(key=lambda item: int(item[0]))
    if not found:
        raise PlgkitError(f"No migration files in {directory}.")
    return found


def _sql_statements(text):
    lines = []
    for line in text.splitlines():
        if "--" in line:
            line = line[: line.index("--")]
        lines.append(line)
    return [part.strip() for part in "\n".join(lines).split(";") if part.strip()]


def _warn_default(name):
    global _warned_default
    with _lock:
        if _warned_default:
            return
        _warned_default = True
    print(
        f"{name} is unset. Using a SQLite file at plgkit_events.sqlite "
        "in the current directory.",
        file=sys.stderr,
    )
