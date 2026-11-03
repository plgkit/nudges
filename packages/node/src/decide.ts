/** Choose which messages to show. This only reads the events table. */
import { countImpressions, dismissContexts, getDefaultDb, type SqlDB } from "./store.ts";

export type Message = Record<string, any>;

export type DecideOptions = {
  db?: SqlDB | null;
  audiences?: Record<string, (ctx: unknown) => boolean> | null;
  config?: Record<string, any> | null;
  now?: Date | null;
};

export function decide(
  location: string,
  ctx: unknown,
  messages: Message[] | null | undefined,
  options: DecideOptions = {},
): Message[] {
  if (typeof location !== "string" || location === "" || !messages || messages.length === 0) return [];
  const db = options.db ?? getDefaultDb();
  const moment = options.now ? new Date(options.now.getTime()) : new Date();
  const settings = options.config ?? {};
  const locations = isRecord(settings.locations) ? settings.locations : {};
  const loc = isRecord(locations[location]) ? locations[location] : {};
  const locationLimit = limitOf(loc, 1);
  const surfaces = isRecord(loc.surfaces) ? loc.surfaces : {};
  const base = typeof settings.assets_base_url === "string" ? settings.assets_base_url : "";
  const userId = userIdOf(ctx);
  const audiences = options.audiences ?? {};

  const candidates: Message[] = [];
  for (const message of messages) {
    if (!messageOk(message)) continue;
    if (message.location !== location) continue;
    if (!isActive(message, moment)) continue;
    if (isDismissed(db, userId, message, ctx)) continue;
    if (!underMaxImpressions(db, userId, message)) continue;
    if (!audienceMatches(message, ctx, audiences)) continue;
    candidates.push(message);
  }
  candidates.sort((a, b) => {
    const delta = priorityOf(a) - priorityOf(b);
    if (delta !== 0) return delta;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });

  const winners: Message[] = [];
  const perSurface: Record<string, number> = {};
  for (const message of candidates) {
    if (winners.length >= locationLimit) break;
    const surface = message.surface as string;
    if ((perSurface[surface] ?? 0) >= limitOf(surfaces[surface], 1)) continue;
    winners.push(message);
    perSurface[surface] = (perSurface[surface] ?? 0) + 1;
  }
  return winners.map((message) => ({
    id: message.id,
    surface: message.surface,
    component: message.component,
    render_props: resolveAssets(message.render_props, base),
  }));
}

export function userIdOf(ctx: unknown): string {
  const user = lookup(ctx, "user");
  if (!user.ok) return "";
  const id = lookup(user.value, "id");
  if (!id.ok || typeof id.value !== "string") return "";
  return id.value;
}

export function lookup(obj: unknown, key: string): { ok: true; value: unknown } | { ok: false } {
  if (!isRecord(obj)) return { ok: false };
  if (Object.prototype.hasOwnProperty.call(obj, key)) return { ok: true, value: obj[key] };
  return { ok: false };
}

export function resolveAssets(value: unknown, base: string): unknown {
  if (Array.isArray(value)) return value.map((item) => resolveAssets(item, base));
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = key === "asset" && typeof item === "string" ? joinAsset(item, base) : resolveAssets(item, base);
  }
  return out;
}

export function joinAsset(asset: string, base: string): string {
  if (asset.startsWith("http://") || asset.startsWith("https://") || asset.startsWith("/")) return asset;
  if (!base) return asset;
  return (base.endsWith("/") ? base : base + "/") + asset;
}

function isDismissed(db: SqlDB, userId: string, message: Message, ctx: unknown): boolean {
  // No dismiss_scope: any dismiss row for this user and nudge matches.
  // With dismiss_scope: every listed key must be on ctx and on the row, with
  // equal values. A row missing a scoped key does not match. If ctx is missing
  // a scoped key, no row matches, so the message can show.
  if (!userId) return false;
  const rows = dismissContexts(db, userId, message.id as string);
  if (!("dismiss_scope" in message) || message.dismiss_scope == null) return rows.length > 0;
  const scope = message.dismiss_scope as string[];
  const ctxValues: Record<string, unknown> = {};
  for (const key of scope) {
    const found = lookup(ctx, key);
    if (!found.ok) return false;
    ctxValues[key] = found.value;
  }
  return rows.some((row) =>
    scope.every((key) => Object.prototype.hasOwnProperty.call(row, key) && row[key] === ctxValues[key]),
  );
}

function underMaxImpressions(db: SqlDB, userId: string, message: Message): boolean {
  if (!("max_impressions" in message) || message.max_impressions == null) return true;
  const cap = asInt(message.max_impressions);
  if (cap == null) return false;
  if (!userId) return true;
  return countImpressions(db, userId, message.id) < cap;
}

function messageOk(message: Message): boolean {
  if (!isRecord(message)) return false;
  if (!nonEmpty(message.id) || !nonEmpty(message.surface) || !nonEmpty(message.component)) return false;
  if (!isRecord(message.render_props)) return false;
  if ("max_impressions" in message && message.max_impressions != null) {
    const cap = asInt(message.max_impressions);
    if (cap == null || cap < 0) return false;
  }
  if ("dismiss_scope" in message && message.dismiss_scope != null) {
    if (!Array.isArray(message.dismiss_scope) || message.dismiss_scope.some((key) => typeof key !== "string" || key === "")) {
      return false;
    }
  }
  if ("priority" in message && message.priority != null && asInt(message.priority) == null) return false;
  if (message.active != null && !isRecord(message.active)) return false;
  if (message.audience != null && !isRecord(message.audience)) return false;
  return true;
}

function isActive(message: Message, now: Date): boolean {
  const active = message.active;
  if (active == null) return true;
  if ("from" in active && active.from != null) {
    const start = parseTime(active.from);
    if (!start || now.getTime() < start.getTime()) return false;
  }
  if ("to" in active && active.to != null) {
    const end = parseTime(active.to);
    if (!end || now.getTime() >= end.getTime()) return false;
  }
  return true;
}

function audienceMatches(
  message: Message,
  ctx: unknown,
  audiences: Record<string, (ctx: unknown) => boolean>,
): boolean {
  const spec = message.audience;
  if (spec == null) return true;
  if (!isRecord(spec)) return false;
  const requireAll = nameList(spec, "require_all");
  const requireOne = nameList(spec, "require_one_of");
  const exclude = nameList(spec, "exclude");
  if (!requireAll || !requireOne || !exclude) return false;
  const names = [...requireAll, ...requireOne, ...exclude];
  const checked = new Map<string, boolean | null>();
  for (const name of names) {
    if (!checked.has(name)) checked.set(name, callAudience(audiences, name, ctx));
  }
  for (const result of checked.values()) {
    if (result == null) return false;
  }
  if (requireAll.some((name) => checked.get(name) !== true)) return false;
  if ("require_one_of" in spec && spec.require_one_of != null) {
    if (!requireOne.some((name) => checked.get(name) === true)) return false;
  }
  if (exclude.some((name) => checked.get(name) === true)) return false;
  return true;
}

function nameList(spec: Record<string, any>, key: string): string[] | null {
  if (!(key in spec) || spec[key] == null) return [];
  const names = spec[key];
  if (!Array.isArray(names) || names.some((name) => typeof name !== "string" || name === "")) return null;
  return names;
}

function callAudience(
  audiences: Record<string, (ctx: unknown) => boolean>,
  name: string,
  ctx: unknown,
): boolean | null {
  const fn = audiences[name];
  if (typeof fn !== "function") return null;
  try {
    const result = fn(ctx);
    return result === true || result === false ? result : null;
  } catch {
    return null;
  }
}

function priorityOf(message: Message): number {
  if (message.priority == null) return 100;
  return asInt(message.priority) ?? 100;
}

function limitOf(container: unknown, fallback: number): number {
  if (!isRecord(container) || container.max == null) return fallback;
  const number = asInt(container.max);
  if (number == null || number < 0) return fallback;
  return number;
}

function asInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return null;
  return value;
}

function parseTime(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dateOnly) return checkedUTC(+dateOnly[1], +dateOnly[2], +dateOnly[3], 0, 0, 0, 0);
  let normalized = text;
  if (normalized.endsWith("Z") || normalized.endsWith("z")) normalized = normalized.slice(0, -1) + "+00:00";
  const full =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?([+-]\d{2}:\d{2})?$/.exec(normalized);
  if (!full) return null;
  const fraction = full[7] ? Number(full[7].slice(0, 3).padEnd(3, "0")) : 0;
  let offsetMinutes = 0;
  if (full[8]) {
    const sign = full[8].startsWith("-") ? -1 : 1;
    const [hours, minutes] = full[8].slice(1).split(":");
    offsetMinutes = sign * (Number(hours) * 60 + Number(minutes));
  }
  const dt = new Date(
    Date.UTC(+full[1], +full[2] - 1, +full[3], +full[4], +full[5] - offsetMinutes, +full[6], fraction),
  );
  if (Number.isNaN(dt.getTime())) return null;
  if (!full[8]) {
    if (dt.getUTCFullYear() !== +full[1] || dt.getUTCMonth() !== +full[2] - 1 || dt.getUTCDate() !== +full[3]) {
      return null;
    }
  }
  return dt;
}

function checkedUTC(year: number, month: number, day: number, hour: number, minute: number, second: number, ms: number): Date | null {
  const dt = new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  return dt;
}

function nonEmpty(value: unknown): boolean {
  return typeof value === "string" && value !== "";
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
