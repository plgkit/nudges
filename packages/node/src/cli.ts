/** `plgkit migrate` creates the events table. `plgkit undismiss` is a dev-only CLI. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate, PlgkitError, undismiss } from "./store.ts";

export function main(argv = process.argv.slice(2)): number {
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    usage();
    return argv.length === 0 ? 1 : 0;
  }
  if (argv[0] === "migrate") {
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
  if (argv[0] === "undismiss") {
    return runUndismiss(argv.slice(1));
  }
  console.error(`Unknown command: ${argv[0]}`);
  usage();
  return 1;
}

function usage() {
  console.error("Usage: plgkit migrate");
  console.error("       plgkit undismiss <nudge_id> --user <user_id>");
}

function runUndismiss(args: string[]): number {
  if (args.length < 1) {
    usage();
    return 1;
  }
  const nudgeId = args[0];
  let userId = "";
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--user") {
      if (i + 1 >= args.length) {
        console.error("Missing value for --user.");
        return 1;
      }
      userId = args[i + 1];
      i++;
      continue;
    }
    console.error(`Unknown argument: ${args[i]}`);
    usage();
    return 1;
  }
  if (!nudgeId) {
    usage();
    return 1;
  }
  if (!userId) {
    console.error("--user is required.");
    usage();
    return 1;
  }
  try {
    undismiss(nudgeId, { user_id: userId });
  } catch (err) {
    if (err instanceof PlgkitError) {
      console.error(err.message);
      return 1;
    }
    throw err;
  }
  return 0;
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked && invoked === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
