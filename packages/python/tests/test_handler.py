import json
import os
import tempfile
import unittest
from pathlib import Path

import plgkit
from plgkit.cli import main
from plgkit.store import set_default_db


def rows(db):
    found = db.execute(
        "SELECT nudge_id, action, user_id, context FROM plgkit_events ORDER BY rowid"
    ).fetchall()
    return [
        {
            "nudge_id": row[0],
            "action": row[1],
            "user_id": row[2],
            "context": json.loads(row[3]),
        }
        for row in found
    ]


class HandlerTests(unittest.TestCase):
    def setUp(self):
        self.db = plgkit.connect("sqlite:///:memory:")
        plgkit.migrate(self.db)

    def test_migrate_can_run_twice(self):
        plgkit.migrate(self.db)
        count = self.db.execute("SELECT COUNT(*) FROM plgkit_schema_migrations").fetchone()[0]
        self.assertEqual(count, 1)
        names = {
            row[0]
            for row in self.db.execute(
                "SELECT name FROM sqlite_master WHERE type IN ('table', 'index')"
            )
        }
        self.assertIn("plgkit_events", names)
        self.assertIn("plgkit_events_user_nudge_action", names)

    def test_keeps_verified_keys_and_drops_the_rest(self):
        seen = []

        def belongs(user_id, value):
            seen.append((user_id, value))
            return value == "acme"

        def not_plan(user_id, value):
            seen.append((user_id, value))
            return False

        status = plgkit.handle_event(
            {
                "nudge_id": "n1",
                "action": "impression",
                "context": {
                    "organization_id": "acme",
                    "plan": "enterprise",
                    "unknown": "x",
                    "user_id": "attacker",
                },
            },
            "u_123",
            {"organization_id": belongs, "plan": not_plan},
            db=self.db,
        )
        self.assertEqual(status, 204)
        self.assertEqual(
            set(seen),
            {("u_123", "acme"), ("u_123", "enterprise")},
        )
        self.assertEqual(
            rows(self.db),
            [
                {
                    "nudge_id": "n1",
                    "action": "impression",
                    "user_id": "u_123",
                    "context": {"organization_id": "acme"},
                }
            ],
        )

    def test_verifier_exception_drops_the_key(self):
        def boom(user_id, value):
            raise RuntimeError("nope")

        status = plgkit.handle_event(
            {
                "nudge_id": "n1",
                "action": "click",
                "context": {"organization_id": "acme"},
            },
            "u_123",
            {"organization_id": boom},
            db=self.db,
        )
        self.assertEqual(status, 204)
        self.assertEqual(rows(self.db)[0]["action"], "click")
        self.assertEqual(rows(self.db)[0]["context"], {})

    def test_bad_body_writes_nothing(self):
        bodies = [
            None,
            [],
            {},
            {"nudge_id": "n1"},
            {"nudge_id": "n1", "action": "nope"},
            {"nudge_id": "", "action": "click"},
            {"nudge_id": 1, "action": "click"},
            {"nudge_id": "n1", "action": "click", "context": ["x"]},
            {
                "nudge_id": "n1",
                "action": "click",
                "context": {"organization_id": {"nested": True}},
            },
        ]
        for body in bodies:
            self.assertEqual(
                plgkit.handle_event(body, "u_123", {}, db=self.db),
                400,
                body,
            )
        self.assertEqual(rows(self.db), [])

    def test_missing_user_is_ignored(self):
        body = {"nudge_id": "n1", "action": "dismiss", "context": {"organization_id": "acme"}}
        self.assertEqual(plgkit.handle_event(body, "", {}, db=self.db), 204)
        self.assertEqual(plgkit.handle_event(body, None, {}, db=self.db), 204)
        self.assertEqual(plgkit.handle_event({"action": "dismiss"}, None, {}, db=self.db), 400)
        self.assertEqual(rows(self.db), [])

    def test_context_can_be_left_out(self):
        status = plgkit.handle_event(
            {"nudge_id": "n1", "action": "dismiss"},
            "u_1",
            {},
            db=self.db,
        )
        self.assertEqual(status, 204)
        self.assertEqual(rows(self.db)[0]["context"], {})

    def test_direct_call_without_user_id_writes_nothing(self):
        plgkit.impression("n1", {"organization_id": "acme"}, db=self.db)
        plgkit.impression("n1", {"user_id": "", "organization_id": "acme"}, db=self.db)
        plgkit.impression("n1", None, db=self.db)
        plgkit.click("", {"user_id": "u_123"}, db=self.db)
        self.assertEqual(rows(self.db), [])
        plgkit.dismiss(
            "n1",
            {"user_id": "u_123", "organization_id": "acme", "nested": {"a": 1}},
            db=self.db,
        )
        self.assertEqual(
            rows(self.db),
            [
                {
                    "nudge_id": "n1",
                    "action": "dismiss",
                    "user_id": "u_123",
                    "context": {"organization_id": "acme"},
                }
            ],
        )

    def test_config_rejects_a_url_without_echoing_the_password(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.yml"
            path.write_text(
                'database_url_env: "postgres://user:secret-password@localhost/db"\n',
                encoding="utf-8",
            )
            with self.assertRaises(plgkit.PlgkitError) as caught:
                plgkit.resolve_database_url(path, environ={})
        text = str(caught.exception)
        self.assertNotIn("secret-password", text)
        self.assertIn("environment variable", text)

        url, used_default = plgkit.resolve_database_url(
            environ={"PLGKIT_DATABASE_URL": "postgres://user:secret-password@localhost/db"}
        )
        self.assertFalse(used_default)
        self.assertTrue(url.startswith("postgres://"))
        with self.assertRaises(plgkit.PlgkitError) as caught:
            plgkit.resolve_database_url(
                environ={"PLGKIT_DATABASE_URL": "mysql://user:secret-password@localhost/db"}
            )
        self.assertNotIn("secret-password", str(caught.exception))
        self.assertNotIn("mysql://", str(caught.exception))
        self.assertIn("mysql", str(caught.exception))
        with self.assertRaises(plgkit.PlgkitError) as caught:
            plgkit.connect("postgres://user:secret-password@127.0.0.1:1/db")
        self.assertNotIn("secret-password", str(caught.exception))
        self.assertNotIn("postgres://", str(caught.exception))

    def test_unset_env_uses_the_sqlite_file(self):
        url, used_default = plgkit.resolve_database_url(environ={})
        self.assertTrue(used_default)
        self.assertEqual(url, "sqlite:///plgkit_events.sqlite")

    def test_cli_migrate_uses_the_named_env_var(self):
        with tempfile.TemporaryDirectory() as directory:
            url = "sqlite:///" + str(Path(directory) / "events.sqlite")
            previous = os.environ.get("PLGKIT_DATABASE_URL")
            os.environ["PLGKIT_DATABASE_URL"] = url
            try:
                with self.assertRaises(SystemExit) as first:
                    main(["migrate"])
                with self.assertRaises(SystemExit) as second:
                    main(["migrate"])
            finally:
                set_default_db(None)
                if previous is None:
                    os.environ.pop("PLGKIT_DATABASE_URL", None)
                else:
                    os.environ["PLGKIT_DATABASE_URL"] = previous
            self.assertEqual(first.exception.code, 0)
            self.assertEqual(second.exception.code, 0)
            self.assertTrue(Path(url.removeprefix("sqlite:///")).is_file())


if __name__ == "__main__":
    unittest.main()
