import unittest
from datetime import datetime, timezone

import plgkit


def message(**overrides):
    base = {
        "id": "banner",
        "location": "home",
        "surface": "main-top",
        "component": "Banner",
        "render_props": {
            "asset": "banner.png",
            "slides": [
                {"asset": "slide.png"},
                {"asset": "https://cdn.example/a.png"},
                {"asset": "/abs.png"},
            ],
        },
        "max_impressions": 2,
    }
    base.update(overrides)
    return base


def ctx(**overrides):
    base = {"user": {"id": "u_123"}, "organization_id": "acme"}
    base.update(overrides)
    return base


class DecideTests(unittest.TestCase):
    def setUp(self):
        self.db = plgkit.connect("sqlite:///:memory:")
        plgkit.migrate(self.db)
        self.config = {
            "assets_base_url": "/static/nudges/",
            "locations": {"home": {"max": 2, "surfaces": {"main-top": {"max": 2}}}},
        }

    def decide(self, messages, context=None, **kwargs):
        return plgkit.decide(
            "home",
            ctx() if context is None else context,
            messages,
            db=self.db,
            config=self.config,
            **kwargs,
        )

    def test_max_impressions(self):
        banner = message()
        original_asset = banner["render_props"]["asset"]
        plgkit.impression("banner", {"user_id": "u_123"}, db=self.db)
        plgkit.impression("banner", {"user_id": "someone_else"}, db=self.db)
        plgkit.click("banner", {"user_id": "u_123"}, db=self.db)
        before = self.db.execute("SELECT COUNT(*) FROM plgkit_events").fetchone()[0]

        shown = self.decide([banner])
        after = self.db.execute("SELECT COUNT(*) FROM plgkit_events").fetchone()[0]
        self.assertEqual(before, after)
        self.assertEqual([item["id"] for item in shown], ["banner"])
        self.assertEqual(shown[0]["render_props"]["asset"], "/static/nudges/banner.png")
        self.assertEqual(
            shown[0]["render_props"]["slides"],
            [
                {"asset": "/static/nudges/slide.png"},
                {"asset": "https://cdn.example/a.png"},
                {"asset": "/abs.png"},
            ],
        )
        self.assertEqual(banner["render_props"]["asset"], original_asset)

        plgkit.impression("banner", {"user_id": "u_123"}, db=self.db)
        self.assertEqual(self.decide([banner]), [])

        unlimited = message(max_impressions=None)
        self.assertEqual([item["id"] for item in self.decide([unlimited])], ["banner"])
        self.assertEqual(self.decide([message(max_impressions=0)]), [])

    def test_dismiss_scope(self):
        banner = message(max_impressions=None)

        plgkit.dismiss("banner", {"user_id": "u_123", "organization_id": "other"}, db=self.db)
        self.assertEqual(self.decide([banner]), [])
        self._clear()

        scoped = message(max_impressions=None, dismiss_scope=["organization_id"])
        plgkit.dismiss("banner", {"user_id": "u_123", "organization_id": "acme"}, db=self.db)
        self.assertEqual(self.decide([scoped]), [])
        self.assertEqual(
            [item["id"] for item in self.decide([scoped], ctx(organization_id="other"))],
            ["banner"],
        )
        self._clear()

        plgkit.dismiss("banner", {"user_id": "u_123"}, db=self.db)
        self.assertEqual([item["id"] for item in self.decide([scoped])], ["banner"])
        self._clear()

        plgkit.dismiss("banner", {"user_id": "u_123", "organization_id": "acme"}, db=self.db)
        bare = {"user": {"id": "u_123"}}
        self.assertEqual([item["id"] for item in self.decide([scoped], bare)], ["banner"])
        self._clear()

        plgkit.dismiss("banner", {"user_id": "other-user", "organization_id": "acme"}, db=self.db)
        plgkit.dismiss("other-nudge", {"user_id": "u_123", "organization_id": "acme"}, db=self.db)
        self.assertEqual([item["id"] for item in self.decide([scoped])], ["banner"])

        both = message(
            max_impressions=None,
            dismiss_scope=["organization_id", "plan"],
        )
        self._clear()
        plgkit.dismiss(
            "banner",
            {"user_id": "u_123", "organization_id": "acme", "plan": "pro"},
            db=self.db,
        )
        self.assertEqual(
            self.decide([both], ctx(organization_id="acme", plan="pro")),
            [],
        )
        self.assertEqual(
            [item["id"] for item in self.decide([both], ctx(organization_id="acme", plan="free"))],
            ["banner"],
        )

    def test_undismiss_cycle(self):
        banner = message(max_impressions=None)
        plgkit.dismiss("banner", {"user_id": "u_123"}, db=self.db)
        self.assertEqual(self.decide([banner]), [])
        plgkit.undismiss("banner", {"user_id": "u_123"}, db=self.db)
        self.assertEqual([item["id"] for item in self.decide([banner])], ["banner"])
        plgkit.dismiss("banner", {"user_id": "u_123"}, db=self.db)
        self.assertEqual(self.decide([banner]), [])

    def test_undismiss_resets_impressions(self):
        banner = message(max_impressions=2)
        plgkit.impression("banner", {"user_id": "u_123"}, db=self.db)
        plgkit.impression("banner", {"user_id": "u_123"}, db=self.db)
        self.assertEqual(self.decide([banner]), [])
        plgkit.undismiss("banner", {"user_id": "u_123"}, db=self.db)
        self.assertEqual([item["id"] for item in self.decide([banner])], ["banner"])

    def test_active_window_and_unknown_audience(self):
        window = message(
            max_impressions=None,
            active={"from": "2026-10-30", "to": "2026-11-01"},
        )
        start = datetime(2026, 10, 30, tzinfo=timezone.utc)
        end = datetime(2026, 11, 1, tzinfo=timezone.utc)
        self.assertEqual([item["id"] for item in self.decide([window], now=start)], ["banner"])
        self.assertEqual(self.decide([window], now=end), [])

        unknown = message(
            max_impressions=None,
            audience={"require_all": ["missing_fn"]},
        )
        self.assertEqual(self.decide([unknown], audiences={}), [])
        open_to_all = message(max_impressions=None)
        self.assertEqual([item["id"] for item in self.decide([open_to_all])], ["banner"])

    def _clear(self):
        self.db.execute("DELETE FROM plgkit_events")


if __name__ == "__main__":
    unittest.main()
