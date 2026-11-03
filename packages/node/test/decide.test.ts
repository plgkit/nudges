import assert from "node:assert/strict";
import test from "node:test";
import { connect, decide, dismiss, undismiss, impression, click, migrate, type SqlDB } from "../src/index.ts";

function message(overrides: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    id: "banner",
    location: "home",
    surface: "main-top",
    component: "Banner",
    render_props: {
      asset: "banner.png",
      slides: [{ asset: "slide.png" }, { asset: "https://cdn.example/a.png" }, { asset: "/abs.png" }],
    },
    max_impressions: 2,
  };
  return { ...base, ...overrides };
}

function ctx(overrides: Record<string, unknown> = {}) {
  return { user: { id: "u_123" }, organization_id: "acme", ...overrides };
}

const config = {
  assets_base_url: "/static/nudges/",
  locations: { home: { max: 2, surfaces: { "main-top": { max: 2 } } } },
};

function openDb(): SqlDB {
  const db = connect("sqlite:///:memory:");
  migrate(db);
  return db;
}

test("max impressions", () => {
  const db = openDb();
  const banner = message();
  impression("banner", { user_id: "u_123" }, db);
  impression("banner", { user_id: "someone_else" }, db);
  click("banner", { user_id: "u_123" }, db);
  const before = Number((db.prepare("SELECT COUNT(*) AS n FROM plgkit_events").get() as { n: number }).n);
  const shown = decide("home", ctx(), [banner], { db, config });
  const after = Number((db.prepare("SELECT COUNT(*) AS n FROM plgkit_events").get() as { n: number }).n);
  assert.equal(before, after);
  assert.deepEqual(shown.map((item) => item.id), ["banner"]);
  assert.equal(shown[0].render_props.asset, "/static/nudges/banner.png");
  assert.deepEqual(shown[0].render_props.slides, [
    { asset: "/static/nudges/slide.png" },
    { asset: "https://cdn.example/a.png" },
    { asset: "/abs.png" },
  ]);
  assert.equal((banner.render_props as { asset: string }).asset, "banner.png");

  impression("banner", { user_id: "u_123" }, db);
  assert.deepEqual(decide("home", ctx(), [banner], { db, config }), []);
  assert.deepEqual(decide("home", ctx(), [message({ max_impressions: null })], { db, config }).map((item) => item.id), [
    "banner",
  ]);
  assert.deepEqual(decide("home", ctx(), [message({ max_impressions: 0 })], { db, config }), []);
});

test("dismiss scope", () => {
  const db = openDb();
  const banner = message({ max_impressions: null });
  dismiss("banner", { user_id: "u_123", organization_id: "other" }, db);
  assert.deepEqual(decide("home", ctx(), [banner], { db, config }), []);
  clear(db);

  const scoped = message({ max_impressions: null, dismiss_scope: ["organization_id"] });
  dismiss("banner", { user_id: "u_123", organization_id: "acme" }, db);
  assert.deepEqual(decide("home", ctx(), [scoped], { db, config }), []);
  assert.deepEqual(
    decide("home", ctx({ organization_id: "other" }), [scoped], { db, config }).map((item) => item.id),
    ["banner"],
  );
  clear(db);

  dismiss("banner", { user_id: "u_123" }, db);
  assert.deepEqual(decide("home", ctx(), [scoped], { db, config }).map((item) => item.id), ["banner"]);
  clear(db);

  dismiss("banner", { user_id: "u_123", organization_id: "acme" }, db);
  assert.deepEqual(decide("home", { user: { id: "u_123" } }, [scoped], { db, config }).map((item) => item.id), [
    "banner",
  ]);
  clear(db);

  dismiss("banner", { user_id: "other-user", organization_id: "acme" }, db);
  dismiss("other-nudge", { user_id: "u_123", organization_id: "acme" }, db);
  assert.deepEqual(decide("home", ctx(), [scoped], { db, config }).map((item) => item.id), ["banner"]);

  const both = message({ max_impressions: null, dismiss_scope: ["organization_id", "plan"] });
  clear(db);
  dismiss("banner", { user_id: "u_123", organization_id: "acme", plan: "pro" }, db);
  assert.deepEqual(decide("home", ctx({ plan: "pro" }), [both], { db, config }), []);
  assert.deepEqual(
    decide("home", ctx({ plan: "free" }), [both], { db, config }).map((item) => item.id),
    ["banner"],
  );
});

test("undismiss resets impressions", () => {
  const db = openDb();
  const banner = message({ max_impressions: 2 });
  impression("banner", { user_id: "u_123" }, db);
  impression("banner", { user_id: "u_123" }, db);
  assert.deepEqual(decide("home", ctx(), [banner], { db, config }), []);
  undismiss("banner", { user_id: "u_123" }, db);
  assert.deepEqual(decide("home", ctx(), [banner], { db, config }).map((item) => item.id), ["banner"]);
});

test("undismiss cycle", () => {
  const db = openDb();
  const banner = message({ max_impressions: null });
  dismiss("banner", { user_id: "u_123" }, db);
  assert.deepEqual(decide("home", ctx(), [banner], { db, config }), []);
  undismiss("banner", { user_id: "u_123" }, db);
  assert.deepEqual(decide("home", ctx(), [banner], { db, config }).map((item) => item.id), ["banner"]);
  dismiss("banner", { user_id: "u_123" }, db);
  assert.deepEqual(decide("home", ctx(), [banner], { db, config }), []);
});

test("active window and unknown audience", () => {
  const db = openDb();
  const window = message({
    max_impressions: null,
    active: { from: "2026-10-30", to: "2026-11-01" },
  });
  const start = new Date(Date.UTC(2026, 9, 30));
  const end = new Date(Date.UTC(2026, 10, 1));
  assert.deepEqual(decide("home", ctx(), [window], { db, config, now: start }).map((item) => item.id), ["banner"]);
  assert.deepEqual(decide("home", ctx(), [window], { db, config, now: end }), []);

  const unknown = message({ max_impressions: null, audience: { require_all: ["missing_fn"] } });
  assert.deepEqual(decide("home", ctx(), [unknown], { db, config, audiences: {} }), []);
  assert.deepEqual(decide("home", ctx(), [message({ max_impressions: null })], { db, config }).map((item) => item.id), [
    "banner",
  ]);
});

function clear(db: SqlDB) {
  db.exec("DELETE FROM plgkit_events");
}
