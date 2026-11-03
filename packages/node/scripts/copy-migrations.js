// Copy core/migrations into this package. core/migrations is the only schema.
// prepack runs this so the published package ships the SQL.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, "../../../core/migrations");
const dest = path.resolve(here, "../migrations");

if (!fs.existsSync(source)) {
  const existing = fs.existsSync(dest)
    ? fs.readdirSync(dest).filter((name) => name.endsWith(".sql"))
    : [];
  if (existing.length > 0) {
    process.exit(0);
  }
  console.error("core/migrations was not found, and this package has no migration files yet.");
  process.exit(1);
}

fs.mkdirSync(dest, { recursive: true });
const keep = new Set();
for (const name of fs.readdirSync(source)) {
  if (!name.endsWith(".sql")) continue;
  fs.copyFileSync(path.join(source, name), path.join(dest, name));
  keep.add(name);
}
if (keep.size === 0) {
  console.error(`No SQL files in ${source}.`);
  process.exit(1);
}
for (const name of fs.readdirSync(dest)) {
  if (name.endsWith(".sql") && !keep.has(name)) fs.unlinkSync(path.join(dest, name));
}
