/**
 * Check a posted event and append one row.
 *
 * handleEvent(body, userId, verify) is framework-agnostic. body is already
 * parsed JSON: {nudge_id, action, context}. userId comes from the session.
 * Any user_id inside context is ignored. verify maps a context key to
 * (userId, value) => boolean. Keys with no function, or a function that is
 * not true, are dropped.
 */
import { canon, click, dismiss, impression, type SqlDB } from "./store.ts";

const actions = { impression, click, dismiss } as const;

export type Verifier = (userId: string, value: unknown) => boolean;

export function handleEvent(
  body: unknown,
  userId: string | null | undefined,
  verify?: Record<string, Verifier> | null,
  db?: SqlDB | null,
): number {
  const parsed = parseBody(body);
  if (!parsed.ok) return 400;
  if (verify != null && (typeof verify !== "object" || Array.isArray(verify))) return 500;
  const checks = verify ?? {};
  if (typeof userId !== "string" || userId === "") return 204;
  const verified: Record<string, unknown> = {};
  for (const key of Object.keys(parsed.context).sort()) {
    const fn = checks[key];
    if (typeof fn !== "function") continue;
    let ok = false;
    try {
      ok = fn(userId, parsed.context[key]) === true;
    } catch {
      ok = false;
    }
    if (ok) verified[key] = parsed.context[key];
  }
  try {
    actions[parsed.action](parsed.nudgeId, { user_id: userId, ...verified }, db);
  } catch {
    console.error("plgkit: could not save the event.");
    return 500;
  }
  return 204;
}

function parseBody(
  body: unknown,
): { ok: true; nudgeId: string; action: keyof typeof actions; context: Record<string, unknown> } | { ok: false } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false };
  const record = body as Record<string, unknown>;
  const nudgeId = record.nudge_id;
  const action = record.action;
  if (typeof nudgeId !== "string" || nudgeId === "") return { ok: false };
  if (action !== "impression" && action !== "click" && action !== "dismiss") return { ok: false };
  let raw = record.context;
  if (raw == null) raw = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false };
  const context: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key === "user_id") continue;
    const cleaned = canon(value);
    if (!cleaned.ok) return { ok: false };
    context[key] = cleaned.value;
  }
  return { ok: true, nudgeId, action, context };
}
