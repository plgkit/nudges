/**
 * Demo backend. Same routes as the Python and Go demos.
 *
 * Listens on http://127.0.0.1:8787.
 * The events file is spec/examples/demo/plgkit_events.sqlite.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { audiences } from "../../../typescript/audiences.ts";
import { connect, decide, handleEvent, migrate } from "../../../../../packages/node/src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const demoDir = path.resolve(here, "../..");
const examplesDir = path.resolve(demoDir, "..");
const dbFile = path.join(demoDir, "plgkit_events.sqlite");
const port = 8787;
const org = "acme";

const people: Record<string, { id: string; name: "user_one" | "user_two" }> = {
  "1": { id: "1", name: "user_one" },
  "2": { id: "2", name: "user_two" },
};
const byName: Record<string, string> = { user_one: "1", user_two: "2" };

const db = connect("sqlite:///" + dbFile);
migrate(db);
const config = parse(fs.readFileSync(path.join(examplesDir, "config.yml"), "utf8"));
const messages = loadMessages();

const verify = {
  organization_id: (userId: string, value: unknown) => value === org && userId in people,
};

const server = http.createServer(async (req, res) => {
  const route = (req.url ?? "/").split("?")[0];
  try {
    if (req.method === "GET" && route === "/api/nudges/session") {
      const person = currentPerson(req.headers.cookie);
      const extra: Record<string, string> = {};
      if (!cookieId(req.headers.cookie)) extra["Set-Cookie"] = sessionCookie(person.id);
      sendJson(res, 200, person, extra);
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(404);
      res.end();
      return;
    }
    const payload = JSON.parse((await readBody(req)) || "{}");
    if (route === "/api/nudges/session") {
      const id = byName[payload?.user];
      if (!id) {
        res.writeHead(400);
        res.end();
        return;
      }
      sendJson(res, 200, people[id], { "Set-Cookie": sessionCookie(id) });
      return;
    }
    if (route === "/api/nudges/decide") {
      const person = currentPerson(req.headers.cookie);
      const location = typeof payload?.location === "string" ? payload.location : "";
      const rows = decide(location, decideCtx(person, payload?.context), messages, {
        db,
        audiences,
        config,
      });
      sendJson(res, 200, rows);
      return;
    }
    if (route === "/api/nudges/events") {
      const person = currentPerson(req.headers.cookie);
      const status = handleEvent(payload, person.id, verify, db);
      res.writeHead(status);
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  } catch {
    res.writeHead(400);
    res.end();
  }
});

server.on("error", () => {
  console.error("Port 8787 is already in use. Stop the other backend first.");
  process.exit(1);
});
server.listen(port, "127.0.0.1", () => {
  console.log(`TypeScript demo backend on http://127.0.0.1:${port}`);
  console.log(`Events file: ${dbFile}`);
});

function decideCtx(person: { id: string; name: string }, pageContext: unknown) {
  const user = {
    id: person.id,
    username: person.name,
    countryCode: "US",
    birthDate: "1990-04-01",
    species: "human",
    isStaff: false,
    hasActiveSubscription: true,
  };
  const ctx: { user: typeof user; organization_id?: string } = { user };
  if (isRecord(pageContext) && pageContext.organization_id === org) ctx.organization_id = org;
  return ctx;
}

function currentPerson(header: string | undefined) {
  const id = cookieId(header);
  return people[id] ?? people["1"];
}

function cookieId(header: string | undefined): string {
  const match = /(?:^|;\s*)plgkit_demo_user=([12])(?:;|$)/.exec(header ?? "");
  return match?.[1] ?? "";
}

function sessionCookie(id: string): string {
  return `plgkit_demo_user=${id}; Path=/; SameSite=Lax`;
}

function loadMessages() {
  const folder = path.join(examplesDir, "messages");
  return fs
    .readdirSync(folder)
    .filter((name) => name.endsWith(".yml"))
    .sort()
    .map((name) => {
      const parsed = parse(fs.readFileSync(path.join(folder, name), "utf8"));
      if (!isRecord(parsed)) return null;
      return { ...parsed, id: name.slice(0, -".yml".length) };
    })
    .filter((message) => message != null);
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  payload: unknown,
  extra: Record<string, string> = {},
) {
  const raw = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json", ...extra });
  res.end(raw);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
