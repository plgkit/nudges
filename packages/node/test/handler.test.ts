import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  click,
  connect,
  dismiss,
  handleEvent,
  impression,
  migrate,
  PlgkitError,
  resolveDatabaseURL,
  setDefaultDb,
  type SqlDB,
} from "../src/index.ts";
import { main } from "../src/cli.ts";

function rows(db: SqlDB) {
  const found = db
    .prepare("SELECT nudge_id, action, user_id, context FROM plgkit_events ORDER BY rowid")
    .all() as { nudge_id: string; action: string; user_id: string; context: string }[];
  return found.map((row) => ({
    nudge_id: row.nudge_id,
    action: row.action,
    user_id: row.user_id,
    context: JSON.parse(row.context),
  }));
}

function openDb(): SqlDB {
  const db = connect("sqlite:///:memory:");
  migrate(db);
  return db;
}

test("migrate can run twice", () => {
  const db = openDb();
  migrate(db);
  const count = db.prepare("SELECT COUNT(*) AS n FROM plgkit_schema_migrations").get() as { n: number };
  assert.equal(Number(count.n), 1);
  const names = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index')").all() as { name: string }[]).map(
      (row) => row.name,
    ),
  );
  assert.equal(names.has("plgkit_events"), true);
  assert.equal(names.has("plgkit_events_user_nudge_action"), true);
});

test("keeps verified keys and drops the rest", () => {
  const db = openDb();
  const seen: [string, unknown][] = [];
  const status = handleEvent(
    {
      nudge_id: "n1",
      action: "impression",
      context: {
        organization_id: "acme",
        plan: "enterprise",
        unknown: "x",
        user_id: "attacker",
      },
    },
    "u_123",
    {
      organization_id: (userId, value) => {
        seen.push([userId, value]);
        return value === "acme";
      },
      plan: (userId, value) => {
        seen.push([userId, value]);
        return false;
      },
    },
    db,
  );
  assert.equal(status, 204);
  assert.deepEqual(seen.sort().toString(), [["u_123", "acme"], ["u_123", "enterprise"]].sort().toString());
  assert.deepEqual(rows(db), [
    { nudge_id: "n1", action: "impression", user_id: "u_123", context: { organization_id: "acme" } },
  ]);
});

test("verifier exception drops the key", () => {
  const db = openDb();
  const status = handleEvent(
    { nudge_id: "n1", action: "click", context: { organization_id: "acme" } },
    "u_123",
    {
      organization_id: () => {
        throw new Error("nope");
      },
    },
    db,
  );
  assert.equal(status, 204);
  assert.equal(rows(db)[0].action, "click");
  assert.deepEqual(rows(db)[0].context, {});
});

test("bad body writes nothing", () => {
  const db = openDb();
  const bodies = [
    null,
    [],
    {},
    { nudge_id: "n1" },
    { nudge_id: "n1", action: "nope" },
    { nudge_id: "", action: "click" },
    { nudge_id: 1, action: "click" },
    { nudge_id: "n1", action: "click", context: ["x"] },
    { nudge_id: "n1", action: "click", context: { organization_id: { nested: true } } },
  ];
  for (const body of bodies) assert.equal(handleEvent(body, "u_123", {}, db), 400);
  assert.deepEqual(rows(db), []);
});

test("missing user is ignored", () => {
  const db = openDb();
  const body = { nudge_id: "n1", action: "dismiss", context: { organization_id: "acme" } };
  assert.equal(handleEvent(body, "", {}, db), 204);
  assert.equal(handleEvent(body, null, {}, db), 204);
  assert.equal(handleEvent({ action: "dismiss" }, null, {}, db), 400);
  assert.deepEqual(rows(db), []);
});

test("context can be left out", () => {
  const db = openDb();
  assert.equal(handleEvent({ nudge_id: "n1", action: "dismiss" }, "u_1", {}, db), 204);
  assert.deepEqual(rows(db)[0].context, {});
});

test("direct call without user id writes nothing", () => {
  const db = openDb();
  impression("n1", { organization_id: "acme" }, db);
  impression("n1", { user_id: "", organization_id: "acme" }, db);
  impression("n1", null, db);
  click("", { user_id: "u_123" }, db);
  assert.deepEqual(rows(db), []);
  dismiss("n1", { user_id: "u_123", organization_id: "acme", nested: { a: 1 } }, db);
  assert.deepEqual(rows(db), [
    { nudge_id: "n1", action: "dismiss", user_id: "u_123", context: { organization_id: "acme" } },
  ]);
});

test("config rejects a url without echoing the password", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "plgkit-"));
  const file = path.join(directory, "config.yml");
  fs.writeFileSync(file, 'database_url_env: "postgres://user:secret-password@localhost/db"\n');
  assert.throws(
    () => resolveDatabaseURL(file, {}),
    (err: unknown) => {
      assert.ok(err instanceof PlgkitError);
      assert.equal(String(err).includes("secret-password"), false);
      assert.equal(String(err).includes("environment variable"), true);
      return true;
    },
  );
  assert.throws(
    () => resolveDatabaseURL(undefined, { PLGKIT_DATABASE_URL: "postgres://user:secret-password@localhost/db" }),
    (err: unknown) => {
      assert.equal(String(err).includes("secret-password"), false);
      assert.equal(String(err).includes("postgres"), true);
      return true;
    },
  );
});

test("unset env uses the sqlite file", () => {
  const found = resolveDatabaseURL(undefined, {});
  assert.equal(found.usedDefault, true);
  assert.equal(found.url, "sqlite:///plgkit_events.sqlite");
});

test("cli migrate uses the named env var", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "plgkit-"));
  const file = path.join(directory, "events.sqlite");
  const previous = process.env.PLGKIT_DATABASE_URL;
  process.env.PLGKIT_DATABASE_URL = "sqlite:///" + file;
  try {
    assert.equal(main(["migrate"]), 0);
    assert.equal(main(["migrate"]), 0);
  } finally {
    setDefaultDb(null);
    if (previous === undefined) delete process.env.PLGKIT_DATABASE_URL;
    else process.env.PLGKIT_DATABASE_URL = previous;
  }
  assert.equal(fs.existsSync(file), true);
});
