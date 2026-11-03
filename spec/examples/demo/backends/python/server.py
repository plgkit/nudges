#!/usr/bin/env python3
"""Demo backend. Same routes as the Go and TypeScript demos.

Run from anywhere. Listens on http://127.0.0.1:8787.
The events file is spec/examples/demo/plgkit_events.sqlite.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
DEMO = HERE.parents[1]
EXAMPLES = DEMO.parent
REPO = EXAMPLES.parents[1]
DB_FILE = DEMO / "plgkit_events.sqlite"

sys.path.insert(0, str(REPO / "packages" / "python"))
sys.path.insert(0, str(EXAMPLES))

import plgkit  # noqa: E402
from audiences import audiences as AUDIENCES  # noqa: E402

PORT = 8787
COOKIE = "plgkit_demo_user"
ORG = "acme"

PEOPLE = {
    "1": {"id": "1", "name": "user_one"},
    "2": {"id": "2", "name": "user_two"},
}
BY_NAME = {"user_one": "1", "user_two": "2"}


def main():
    global DB, MESSAGES, CONFIG
    DB = plgkit.connect("sqlite:///" + DB_FILE.as_posix())
    plgkit.migrate(DB)
    CONFIG = load_yaml((EXAMPLES / "config.yml").read_text(encoding="utf-8")) or {}
    MESSAGES = load_messages()
    try:
        server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError:
        print("Port 8787 is already in use. Stop the other backend first.", file=sys.stderr)
        raise SystemExit(1)
    print(f"Python demo backend on http://127.0.0.1:{PORT}")
    print(f"Events file: {DB_FILE}")
    server.serve_forever()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if path_of(self.path) != "/api/nudges/session":
            self.send_error(404)
            return
        person = current_person(self.headers.get("Cookie"))
        body = {"id": person["id"], "name": person["name"]}
        extra = {}
        if not cookie_id(self.headers.get("Cookie")):
            extra["Set-Cookie"] = session_cookie(person["id"])
        send_json(self, 200, body, extra)

    def do_POST(self):
        route = path_of(self.path)
        try:
            payload = json.loads(read_body(self) or "{}")
        except json.JSONDecodeError:
            self.send_error(400)
            return
        if route == "/api/nudges/session":
            name = payload.get("user") if isinstance(payload, dict) else None
            user_id = BY_NAME.get(name)
            if not user_id:
                self.send_error(400)
                return
            person = PEOPLE[user_id]
            send_json(
                self,
                200,
                {"id": person["id"], "name": person["name"]},
                {"Set-Cookie": session_cookie(user_id)},
            )
            return
        if route == "/api/nudges/decide":
            person = current_person(self.headers.get("Cookie"))
            location = payload.get("location") if isinstance(payload, dict) else ""
            context = payload.get("context") if isinstance(payload, dict) else None
            rows = plgkit.decide(
                location if isinstance(location, str) else "",
                decide_ctx(person, context),
                MESSAGES,
                db=DB,
                audiences=AUDIENCES,
                config=CONFIG,
            )
            send_json(self, 200, rows)
            return
        if route == "/api/nudges/events":
            person = current_person(self.headers.get("Cookie"))
            status = plgkit.handle_event(payload, person["id"], VERIFY, db=DB)
            self.send_response(status)
            self.end_headers()
            return
        self.send_error(404)

    def log_message(self, fmt, *args):
        return


def decide_ctx(person, page_context):
    user = SimpleNamespace(
        id=person["id"],
        username=person["name"],
        country_code="US",
        birth_date=date(1990, 4, 1),
        species="human",
        is_staff=False,
        has_active_subscription=True,
        email=None,
        mobile=None,
    )
    org = "acme" if org_ok(page_context) else None
    return SimpleNamespace(user=user, organization_id=org, req=None)


def org_ok(page_context):
    if not isinstance(page_context, dict):
        return False
    return page_context.get("organization_id") == ORG


VERIFY = {
    "organization_id": lambda user_id, value: value == ORG and user_id in PEOPLE,
}


def current_person(header):
    found = cookie_id(header)
    if found in PEOPLE:
        return PEOPLE[found]
    return PEOPLE["1"]


def cookie_id(header):
    if not header:
        return ""
    match = re.search(r"(?:^|;\s*)plgkit_demo_user=([12])(?:;|$)", header)
    return match.group(1) if match else ""


def session_cookie(user_id):
    return f"{COOKIE}={user_id}; Path=/; SameSite=Lax"


def path_of(raw):
    return raw.split("?", 1)[0]


def read_body(handler):
    length = int(handler.headers.get("Content-Length") or 0)
    return handler.rfile.read(length).decode("utf8") if length else ""


def send_json(handler, status, payload, extra=None):
    raw = json.dumps(payload).encode("utf8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(raw)))
    for key, value in (extra or {}).items():
        handler.send_header(key, value)
    handler.end_headers()
    handler.wfile.write(raw)


def load_messages():
    found = []
    folder = EXAMPLES / "messages"
    for path in sorted(folder.glob("*.yml")):
        parsed = load_yaml(path.read_text(encoding="utf-8"))
        if not isinstance(parsed, dict):
            continue
        parsed["id"] = path.name[: -len(".yml")]
        found.append(parsed)
    return found


def load_yaml(text):
    lines = []
    for raw in text.splitlines():
        clean = _strip_comment(raw)
        if not clean.strip():
            continue
        lines.append((len(clean) - len(clean.lstrip(" ")), clean.strip()))
    value, _ = _parse_node(lines, 0, 0)
    return value


def _strip_comment(line):
    quote = None
    out = []
    for ch in line:
        if quote:
            if ch == quote:
                quote = None
            out.append(ch)
            continue
        if ch in ("'", '"'):
            quote = ch
            out.append(ch)
            continue
        if ch == "#":
            break
        out.append(ch)
    return "".join(out).rstrip()


def _parse_node(lines, index, indent):
    if index >= len(lines) or lines[index][0] < indent:
        return None, index
    if lines[index][1].startswith("- "):
        return _parse_list(lines, index, lines[index][0])
    return _parse_map(lines, index, lines[index][0])


def _parse_map(lines, index, indent):
    result = {}
    while index < len(lines):
        cur, content = lines[index]
        if cur != indent or content.startswith("- "):
            break
        key, _, rest = content.partition(":")
        rest = rest.strip()
        index += 1
        if rest == "" and index < len(lines) and lines[index][0] > indent:
            child, index = _parse_node(lines, index, lines[index][0])
            result[key.strip()] = child
        elif rest == "":
            result[key.strip()] = None
        else:
            result[key.strip()] = _parse_scalar(rest)
    return result, index


def _parse_list(lines, index, indent):
    result = []
    while index < len(lines):
        cur, content = lines[index]
        if cur != indent or not content.startswith("- "):
            break
        item = content[2:].strip()
        index += 1
        if item.startswith(("'", '"', "[")) or ":" not in item:
            result.append(_parse_scalar(item) if item else None)
            continue
        key, _, rest = item.partition(":")
        block = [(indent + 2, f"{key.strip()}: {rest.strip()}".rstrip())]
        while index < len(lines) and lines[index][0] > indent:
            block.append(lines[index])
            index += 1
        child, _ = _parse_map(block, 0, indent + 2)
        result.append(child)
    return result, index


def _parse_scalar(text):
    text = text.strip()
    if text.startswith("[") and text.endswith("]"):
        inner = text[1:-1].strip()
        if not inner:
            return []
        return [_parse_scalar(part) for part in _split_commas(inner)]
    if len(text) >= 2 and text[0] == text[-1] and text[0] in ("'", '"'):
        return text[1:-1]
    if text in ("true", "True"):
        return True
    if text in ("false", "False"):
        return False
    if text in ("null", "~", ""):
        return None
    if re.fullmatch(r"-?\d+", text):
        return int(text)
    return text


def _split_commas(text):
    parts = []
    buf = []
    quote = None
    for ch in text:
        if quote:
            buf.append(ch)
            if ch == quote:
                quote = None
            continue
        if ch in ("'", '"'):
            quote = ch
            buf.append(ch)
            continue
        if ch == ",":
            parts.append("".join(buf).strip())
            buf = []
            continue
        buf.append(ch)
    if buf:
        parts.append("".join(buf).strip())
    return parts


if __name__ == "__main__":
    main()
