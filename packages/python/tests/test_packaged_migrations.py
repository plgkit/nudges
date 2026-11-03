"""The installed package ships the SQL. It does not look up the repo."""

import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
CORE = REPO / "core" / "migrations"


class PackagedMigrationTests(unittest.TestCase):
    def test_wheel_migrates_away_from_the_repo(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            wheel_dir = tmp_path / "wheels"
            wheel_dir.mkdir()
            built = subprocess.run(
                [sys.executable, "setup.py", "bdist_wheel", "-d", str(wheel_dir)],
                cwd=ROOT,
                capture_output=True,
                text=True,
            )
            if built.returncode != 0:
                self.fail(built.stdout + "\n" + built.stderr)
            wheels = list(wheel_dir.glob("*.whl"))
            self.assertEqual(len(wheels), 1, wheels)
            extract = tmp_path / "pkg"
            with zipfile.ZipFile(wheels[0]) as archive:
                archive.extractall(extract)
            shipped = extract / "plgkit" / "migrations"
            shipped_files = sorted(p.name for p in shipped.glob("*.sql"))
            core_files = sorted(p.name for p in CORE.glob("*.sql"))
            self.assertEqual(shipped_files, core_files)
            self.assertTrue(core_files)
            for name in core_files:
                self.assertEqual((shipped / name).read_bytes(), (CORE / name).read_bytes())

            env = os.environ.copy()
            env["PYTHONPATH"] = str(extract)
            env.pop("PLGKIT_MIGRATIONS_DIR", None)
            subprocess.check_call(
                [
                    sys.executable,
                    "-c",
                    (
                        "import plgkit\n"
                        "db = plgkit.connect('sqlite:///:memory:')\n"
                        "plgkit.migrate(db)\n"
                        "row = db.execute(\"SELECT name FROM sqlite_master "
                        "WHERE type='table' AND name='plgkit_events'\").fetchone()\n"
                        "assert row, 'table missing'\n"
                    ),
                ],
                cwd=extract,
                env=env,
            )

    def tearDown(self):
        shutil.rmtree(ROOT / "build", ignore_errors=True)
        shutil.rmtree(ROOT / "plgkit.egg-info", ignore_errors=True)
        shutil.rmtree(ROOT / "dist", ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
