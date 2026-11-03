import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { audiences } from "../typescript/audiences.ts";

/** Fixed person for this demo. The browser's user_id is never used. */
const DEMO_USER_ID = "demo-user";
const DEMO_ORG = "acme";

const demoUser = {
  id: DEMO_USER_ID,
  username: "ada",
  countryCode: "US",
  birthDate: "1990-04-01",
  species: "human",
  isStaff: false,
  hasActiveSubscription: true,
};

type Message = {
  id: string;
  location?: string;
  surface?: string;
  component?: string;
  render_props?: Record<string, unknown>;
  priority?: number;
  max_impressions?: number;
  dismiss_scope?: string[];
  active?: { from?: unknown; to?: unknown };
  audience?: {
    require_all?: string[];
    require_one_of?: string[];
    exclude?: string[];
  };
};

type StoredEvent = {
  nudge_id: string;
  action: "impression" | "click" | "dismiss";
  user_id: string;
  context: Record<string, string>;
};

type Config = {
  assets_base_url?: string;
  locations?: Record<
    string,
    { max?: number; surfaces?: Record<string, { max?: number } | undefined> }
  >;
};

let messagesDir = path.resolve(process.cwd(), "../messages");
let configPath = path.resolve(process.cwd(), "../config.yml");

const events: StoredEvent[] = [];

export function useExampleFiles(dir: string): void {
  messagesDir = path.join(dir, "messages");
  configPath = path.join(dir, "config.yml");
}

export function decide(location: string, rawContext: unknown) {
  const context = checkedContext(rawContext);
  const config = loadConfig();
  const now = Date.now();
  const place = config.locations?.[location] ?? {};
  const locationLimit = place.max ?? 1;
  const surfaces = place.surfaces ?? {};
  const candidates = loadMessages().filter((message) => {
    if (message.location !== location) return false;
    if (!message.surface || !message.component || message.render_props == null) return false;
    if (!isActive(message, now)) return false;
    if (isDismissed(message, context)) return false;
    if (!underMaxImpressions(message)) return false;
    if (!audienceMatches(message)) return false;
    return true;
  });
  candidates.sort((a, b) => {
    const byPriority = (a.priority ?? 100) - (b.priority ?? 100);
    if (byPriority !== 0) return byPriority;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });

  const winners: Message[] = [];
  const perSurface: Record<string, number> = {};
  for (const message of candidates) {
    if (winners.length >= locationLimit) break;
    const surface = message.surface as string;
    const surfaceLimit = surfaces[surface]?.max ?? 1;
    if ((perSurface[surface] ?? 0) >= surfaceLimit) continue;
    winners.push(message);
    perSurface[surface] = (perSurface[surface] ?? 0) + 1;
  }

  const base = config.assets_base_url ?? "/static/nudges/";
  const rows = winners.map((message) => ({
    id: message.id,
    surface: message.surface,
    component: message.component,
    render_props: resolveAssets(message.render_props, base),
  }));
  console.log(`[nudges] decide ${location} -> ${rows.map((row) => row.id).join(", ") || "(nothing)"}`);
  return rows;
}

export function recordEvent(body: unknown): void {
  if (!body || typeof body !== "object") {
    console.log("[nudges] ignored event");
    return;
  }
  const incoming = body as { nudge_id?: unknown; action?: unknown; context?: unknown };
  const nudgeId = typeof incoming.nudge_id === "string" ? incoming.nudge_id : "";
  const action = incoming.action;
  if (!nudgeId || (action !== "impression" && action !== "click" && action !== "dismiss")) {
    console.log("[nudges] ignored event");
    return;
  }
  const context = checkedContext(incoming.context);
  if (action === "dismiss" && missingScope(nudgeId, context)) {
    console.log(`[nudges] dismiss ${nudgeId} ignored (missing page facts) user=${DEMO_USER_ID}`);
    return;
  }
  events.push({ nudge_id: nudgeId, action, user_id: DEMO_USER_ID, context });
  const org = context.organization_id ? ` organization_id=${context.organization_id}` : "";
  console.log(`[nudges] ${action} ${nudgeId}${org} user=${DEMO_USER_ID}`);
}

/** Keep organization_id only for the demo org. Drop user_id and anything else. */
function checkedContext(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const org = (value as { organization_id?: unknown }).organization_id;
  if (org === DEMO_ORG) return { organization_id: DEMO_ORG };
  return {};
}

function missingScope(nudgeId: string, context: Record<string, string>): boolean {
  const scope = loadMessages().find((message) => message.id === nudgeId)?.dismiss_scope;
  if (!scope || scope.length === 0) return false;
  return scope.some((key) => context[key] === undefined);
}

function isDismissed(message: Message, context: Record<string, string>): boolean {
  const scope = message.dismiss_scope;
  return events.some((event) => {
    if (event.action !== "dismiss" || event.nudge_id !== message.id) return false;
    if (event.user_id !== DEMO_USER_ID) return false;
    if (!scope || scope.length === 0) return true;
    return scope.every((key) => context[key] !== undefined && event.context[key] === context[key]);
  });
}

function underMaxImpressions(message: Message): boolean {
  if (message.max_impressions == null) return true;
  const seen = events.filter(
    (event) =>
      event.action === "impression" &&
      event.nudge_id === message.id &&
      event.user_id === DEMO_USER_ID,
  ).length;
  return seen < message.max_impressions;
}

function audienceMatches(message: Message): boolean {
  const rules = message.audience;
  if (!rules) return true;
  const ctx = { user: demoUser, organization_id: DEMO_ORG };
  const answer = (name: string): boolean | null => {
    if (!(name in audiences)) return null;
    return audiences[name as keyof typeof audiences](ctx);
  };
  if (rules.require_all?.some((name) => answer(name) !== true)) return false;
  if (rules.require_one_of && !rules.require_one_of.some((name) => answer(name) === true)) {
    return false;
  }
  if (rules.exclude?.some((name) => answer(name) === true)) return false;
  return true;
}

function isActive(message: Message, now: number): boolean {
  const from = instant(message.active?.from);
  const to = instant(message.active?.to);
  if (message.active?.from != null && from == null) return false;
  if (message.active?.to != null && to == null) return false;
  if (from != null && now < from) return false;
  if (to != null && now >= to) return false;
  return true;
}

function instant(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value !== "string") return null;
  const text = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
  const time = Date.parse(text);
  return Number.isNaN(time) ? null : time;
}

function loadConfig(): Config {
  const parsed = parse(fs.readFileSync(configPath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as Config;
}

function loadMessages(): Message[] {
  return fs
    .readdirSync(messagesDir)
    .filter((name) => name.endsWith(".yml"))
    .map((name) => readMessage(name))
    .filter((message): message is Message => message != null);
}

function readMessage(name: string): Message | null {
  const parsed = parse(fs.readFileSync(path.join(messagesDir, name), "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const row = parsed as Record<string, unknown>;
  const active = isPlain(row.active) ? row.active : undefined;
  const audience = isPlain(row.audience) ? row.audience : undefined;
  return {
    id: name.slice(0, -".yml".length),
    location: asString(row.location),
    surface: asString(row.surface),
    component: asString(row.component),
    render_props: isPlain(row.render_props) ? row.render_props : undefined,
    priority: typeof row.priority === "number" ? row.priority : undefined,
    max_impressions: typeof row.max_impressions === "number" ? row.max_impressions : undefined,
    dismiss_scope: stringList(row.dismiss_scope),
    active,
    audience: audience
      ? {
          require_all: stringList(audience.require_all),
          require_one_of: stringList(audience.require_one_of),
          exclude: stringList(audience.exclude),
        }
      : undefined,
  };
}

function resolveAssets(value: unknown, base: string): unknown {
  if (Array.isArray(value)) return value.map((item) => resolveAssets(item, base));
  if (!isPlain(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = key === "asset" && typeof child === "string" ? joinAsset(child, base) : resolveAssets(child, base);
  }
  return out;
}

function joinAsset(asset: string, base: string): string {
  if (asset.startsWith("http://") || asset.startsWith("https://") || asset.startsWith("/")) return asset;
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return prefix + asset;
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = value.filter((item): item is string => typeof item === "string");
  return names.length > 0 ? names : undefined;
}
