"""Postgres checks. They run when PLGKIT_TEST_DATABASE_URL is a postgres URL."""

import os
import unittest
import uuid

import plgkit

TEST_URL = os.environ.get("PLGKIT_TEST_DATABASE_URL", "").strip()


def _postgres_url():
    return TEST_URL.startswith("postgres://") or TEST_URL.startswith("postgresql://")


@unittest.skipUnless(_postgres_url(), "set PLGKIT_TEST_DATABASE_URL to a postgres URL")
class PostgresTests(unittest.TestCase):
    def test_migrate_and_decide(self):
        nudge = "pgtest-" + uuid.uuid4().hex
        db = plgkit.connect(TEST_URL)
        self.addCleanup(db.close)
        self.addCleanup(lambda: db.execute("DELETE FROM plgkit_events WHERE nudge_id = ?", (nudge,)))
        plgkit.migrate(db)
        plgkit.migrate(db)
        user = {"user_id": "u_pg", "organization_id": "acme"}
        plgkit.impression(nudge, user, db=db)
        plgkit.click(nudge, user, db=db)
        shown = plgkit.decide(
            "home",
            {"user": {"id": "u_pg"}, "organization_id": "acme"},
            [{
                "id": nudge,
                "location": "home",
                "surface": "main-top",
                "component": "Banner",
                "render_props": {},
                "max_impressions": 1,
            }],
            db=db,
        )
        self.assertEqual(shown, [])
        plgkit.dismiss(nudge, user, db=db)
        hidden = plgkit.decide(
            "home",
            {"user": {"id": "u_pg"}, "organization_id": "acme"},
            [{
                "id": nudge,
                "location": "home",
                "surface": "main-top",
                "component": "Banner",
                "render_props": {},
                "dismiss_scope": ["organization_id"],
            }],
            db=db,
        )
        self.assertEqual(hidden, [])
        other = plgkit.decide(
            "home",
            {"user": {"id": "u_pg"}, "organization_id": "other"},
            [{
                "id": nudge,
                "location": "home",
                "surface": "main-top",
                "component": "Banner",
                "render_props": {},
                "dismiss_scope": ["organization_id"],
            }],
            db=db,
        )
        self.assertEqual([item["id"] for item in other], [nudge])


if __name__ == "__main__":
    unittest.main()
