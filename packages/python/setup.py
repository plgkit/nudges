"""Copy core/migrations into this package, then build.

core/migrations is the only schema. The wheel and sdist ship the copy so an
installed package does not need the rest of the repo.
"""

from pathlib import Path

from setuptools import setup
from setuptools.command.build_py import build_py
from setuptools.command.sdist import sdist


def copy_migrations():
    here = Path(__file__).resolve().parent
    source = here.parents[1] / "core" / "migrations"
    dest = here / "plgkit" / "migrations"
    if not source.is_dir():
        if dest.is_dir() and any(dest.glob("*.sql")):
            return
        raise SystemExit(
            "core/migrations was not found, and this package has no migration files yet."
        )
    dest.mkdir(parents=True, exist_ok=True)
    keep = set()
    for sql in sorted(source.glob("*.sql")):
        (dest / sql.name).write_bytes(sql.read_bytes())
        keep.add(sql.name)
    if not keep:
        raise SystemExit(f"No SQL files in {source}.")
    for old in dest.glob("*.sql"):
        if old.name not in keep:
            old.unlink()


class BuildPy(build_py):
    def run(self):
        copy_migrations()
        super().run()


class SDist(sdist):
    def run(self):
        copy_migrations()
        super().run()


setup(cmdclass={"build_py": BuildPy, "sdist": SDist})
