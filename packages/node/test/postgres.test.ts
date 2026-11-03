import assert from "node:assert/strict";
import test from "node:test";
import { connect, decide, dismiss, impression, migrate } from "../src/index.ts";

const url = (process.env.PLGKIT_TEST_DATABASE_URL ?? "").trim();
const enabled = url.startsWith("postgres://") || url.startsWith("postgresql://");

test("postgres migrate and decide", { skip: enabled ? false : "set PLGKIT_TEST_DATABASE_URL to a postgres URL" }, () => {
  const db = connect(url);
  let nudge = "";
  try {
    migrate(db);
    migrate(db);
    nudge = "pgtest-ts-" + crypto.randomUUID();
    impression(nudge, { user_id: "u_pg", organization_id: "acme" }, db);
    const shown = decide(
      "home",
      { user: { id: "u_pg" }, organization_id: "acme" },
      [
        {
          id: nudge,
          location: "home",
          surface: "main-top",
          component: "Banner",
          render_props: {},
          max_impressions: 1,
        },
      ],
      { db },
    );
    assert.deepEqual(shown, []);
    dismiss(nudge, { user_id: "u_pg", organization_id: "other" }, db);
    const still = decide(
      "home",
      { user: { id: "u_pg" }, organization_id: "acme" },
      [
        {
          id: nudge,
          location: "home",
          surface: "main-top",
          component: "Banner",
          render_props: {},
          dismiss_scope: ["organization_id"],
        },
      ],
      { db },
    );
    assert.deepEqual(still.map((item) => item.id), [nudge]);
  } finally {
    try {
      db.prepare("DELETE FROM plgkit_events WHERE nudge_id = ?").run(nudge);
    } finally {
      db.close?.();
    }
  }
});
