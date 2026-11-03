/** `plgkit migrate` creates the events table. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate, PlgkitError } from "./store.ts";

export function main(argv = process.argv.slice(2)): number {
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    console.error("Usage: plgkit migrate");
    return argv.length === 0 ? 1 : 0;
  }
  if (argv[0] !== "migrate") {
    console.error(`Unknown command: ${argv[0]}`);
    console.error("Usage: plgkit migrate");
    return 1;
  }
  try {
    migrate();
  } catch (err) {
    if (err instanceof PlgkitError) {
      console.error(err.message);
      return 1;
    }
    throw err;
  }
  console.log("Migrations are up to date.");
  return 0;
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked && invoked === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
