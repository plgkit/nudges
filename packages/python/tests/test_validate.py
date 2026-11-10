import shutil
import tempfile
import unittest
from pathlib import Path

from plgkit.validate import audience_names_from_python, load_nudges_dir, validate

REPO = Path(__file__).resolve().parents[3]
EXAMPLES = REPO / "spec" / "examples"


class ValidateTests(unittest.TestCase):
    def test_spec_examples_pass(self):
        config, messages, names = load_nudges_dir(EXAMPLES)
        problems = validate(config, messages, names)
        self.assertEqual(problems, [])

    def test_unknown_audience_in_each_list(self):
        for key in ("require_all", "require_one_of", "exclude"):
            with self.subTest(key=key):
                config = {"locations": {"home": {"max": 1}}}
                messages = [
                    {
                        "_path": "messages/x.yml",
                        "id": "20260101120000-test-banner",
                        "audience": {key: ["missing_fn"]},
                    },
                ]
                problems = validate(config, messages, {"is_human"})
                self.assertTrue(any("missing_fn" in line for line in problems))

    def test_omitted_audience_passes(self):
        config = {}
        messages = [{"_path": "messages/x.yml", "id": "20260101120000-test-banner"}]
        self.assertEqual(validate(config, messages, set()), [])

    def test_surface_max_above_location_fails(self):
        config = {
            "locations": {
                "home": {
                    "max": 1,
                    "surfaces": {"sidebar": {"max": 3}},
                },
            },
        }
        self.assertTrue(any("sidebar" in line for line in validate(config, [], set())))

    def test_surface_max_equal_passes(self):
        config = {
            "locations": {
                "home": {
                    "max": 2,
                    "surfaces": {"main-top": {"max": 2}},
                },
            },
        }
        self.assertEqual(validate(config, [], set()), [])

    def test_missing_location_max_defaults_to_one(self):
        config = {
            "locations": {
                "home": {
                    "surfaces": {"sidebar": {"max": 2}},
                },
            },
        }
        problems = validate(config, [], set())
        self.assertTrue(any("sidebar" in line and "max 2" in line for line in problems))

    def test_audience_names_from_python(self):
        names = audience_names_from_python(EXAMPLES / "audiences.py")
        self.assertIn("is_human", names)
        self.assertIn("has_active_supersuit_subscription", names)

    def test_cli_load_layout(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shutil.copytree(EXAMPLES / "messages", root / "messages")
            shutil.copy(EXAMPLES / "config.yml", root / "config.yml")
            shutil.copy(EXAMPLES / "audiences.py", root / "audiences.py")
            config, messages, names = load_nudges_dir(root)
            self.assertEqual(validate(config, messages, names), [])


if __name__ == "__main__":
    unittest.main()
