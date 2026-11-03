import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(here, "..");
const coreDir = path.resolve(here, "../../../core/migrations");

test("packed package migrates away from the repo", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plgkit-pack-"));
  const packed = execFileSync("npm", ["pack", "--json", "--pack-destination", tmp], {
    cwd: packageDir,
    encoding: "utf8",
  });
  const info = JSON.parse(packed);
  const filename = Array.isArray(info) ? info[0].filename : info.filename;
  const tarball = path.join(tmp, filename);
  execFileSync("tar", ["-xzf", tarball, "-C", tmp]);
  const extracted = path.join(tmp, "package");
  const shippedDir = path.join(extracted, "migrations");
  const shipped = fs.readdirSync(shippedDir).filter((name) => name.endsWith(".sql")).sort();
  const core = fs.readdirSync(coreDir).filter((name) => name.endsWith(".sql")).sort();
  assert.deepEqual(shipped, core);
  assert.ok(core.length > 0);
  for (const name of core) {
    assert.equal(
      fs.readFileSync(path.join(shippedDir, name), "utf8"),
      fs.readFileSync(path.join(coreDir, name), "utf8"),
    );
  }
  const env = { ...process.env };
  delete env.PLGKIT_MIGRATIONS_DIR;
  execFileSync(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      [
        "import { connect, migrate } from './src/index.ts';",
        "const db = connect('sqlite:///:memory:');",
        "migrate(db);",
        "const row = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='plgkit_events'\").get();",
        "if (!row) process.exit(1);",
      ].join("\n"),
    ],
    { cwd: extracted, env },
  );
});
