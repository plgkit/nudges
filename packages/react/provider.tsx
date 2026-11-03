import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NudgeContext, type NudgeApi, type TrackAction } from "./context.js";
import type { DecideFn, NudgeItem, NudgeRegistry } from "./types.js";

export type NudgeProviderProps = {
  /** Page name sent to decide(). Every slot on this page shares that one call. */
  location: string;
  /** Your URL. We POST events here. This package does not pick the path. */
  endpoint: string;
  /** Flat page facts sent with every event. `user_id` is dropped. */
  context?: Record<string, unknown>;
  /** Component name to React component. */
  registry: NudgeRegistry;
  /**
   * Calls your backend as `decide(location, context)`. `context` is the flat
   * page facts, with `user_id` left out. Return the list the backend already
   * chose. We do not pick messages here.
   */
  decide: DecideFn;
  children?: ReactNode;
};

type EventAction = TrackAction | "impression";

const emptyRegistry: NudgeRegistry = {};

export function NudgeProvider({
  location,
  endpoint,
  context,
  registry,
  decide,
  children,
}: NudgeProviderProps) {
  const [items, setItems] = useState<NudgeItem[]>([]);
  const [resultId, setResultId] = useState(0);

  const decideRef = useRef(decide);
  const endpointRef = useRef(endpoint);
  const contextRef = useRef(context);
  const seenRef = useRef<Set<string>>(new Set());
  const anchorsRef = useRef<Map<string, HTMLElement>>(new Map());
  const requestRef = useRef(0);

  decideRef.current = decide;
  endpointRef.current = endpoint;
  contextRef.current = context;

  const registryOrEmpty = registry ?? emptyRegistry;
  const facts = factsFrom(context) ?? EMPTY_FACTS;
  const [stableFacts, setStableFacts] = useState(facts);
  if (!shallowEqual(stableFacts, facts)) setStableFacts(facts);

  useEffect(() => {
    const request = ++requestRef.current;
    let cancelled = false;
    setItems((current) => (current.length === 0 ? current : []));

    async function run() {
      try {
        const ask = decideRef.current;
        if (typeof ask !== "function") {
          console.warn("NudgeProvider needs a decide function. Showing nothing.");
          return;
        }
        const pageFacts = factsFrom(contextRef.current);
        const result = await ask(location, pageFacts);
        if (cancelled || request !== requestRef.current) return;
        if (!Array.isArray(result)) {
          console.warn("NudgeProvider decide() did not return a list. Showing nothing.");
          setItems([]);
          return;
        }
        const rows: NudgeItem[] = [];
        for (const row of result) {
          if (isNudgeRow(row)) rows.push(row);
          else console.warn("NudgeProvider skipped a decide() row it could not read.");
        }
        // A new decide() result may count a view again. Remounts of the same result do not.
        seenRef.current = new Set();
        setItems(rows);
        setResultId((id) => id + 1);
      } catch (err) {
        if (cancelled || request !== requestRef.current) return;
        console.warn("NudgeProvider decide() failed. Showing nothing.", err);
        setItems([]);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [location, stableFacts]);

  const api = useMemo<NudgeApi>(() => {
    return {
      items,
      registry: registryOrEmpty,
      resultId,
      impression(nudgeId) {
        if (!nudgeId) return;
        if (seenRef.current.has(nudgeId)) return;
        seenRef.current.add(nudgeId);
        postEvent(endpointRef.current, contextRef.current, nudgeId, "impression");
      },
      send(nudgeId, action) {
        if (!nudgeId) return;
        postEvent(endpointRef.current, contextRef.current, nudgeId, action);
      },
      setAnchor(nudgeId, node) {
        if (!nudgeId) return;
        if (node) anchorsRef.current.set(nudgeId, node);
        else anchorsRef.current.delete(nudgeId);
      },
      getAnchor(nudgeId) {
        return anchorsRef.current.get(nudgeId) ?? null;
      },
    };
  }, [items, registryOrEmpty, resultId]);

  return <NudgeContext.Provider value={api}>{children}</NudgeContext.Provider>;
}

const EMPTY_FACTS: Record<string, unknown> = {};

function shallowEqual(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key) || !Object.is(left[key], right[key])) {
      return false;
    }
  }
  return true;
}

function isNudgeRow(value: unknown): value is NudgeItem {
  if (typeof value !== "object" || value === null) return false;
  const row = value as NudgeItem;
  return typeof row.id === "string" && row.id.length > 0 && typeof row.surface === "string";
}

/** Page facts for the POST body. `user_id` stays on the server session, so we never send it. */
function factsFrom(
  context: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!context) return undefined;
  const facts: Record<string, unknown> = {};
  for (const key of Object.keys(context).sort()) {
    if (key === "user_id") continue;
    const value = context[key];
    if (value === undefined) continue;
    facts[key] = value;
  }
  return Object.keys(facts).length > 0 ? facts : undefined;
}

function postEvent(
  endpoint: string,
  context: Record<string, unknown> | undefined,
  nudgeId: string,
  action: EventAction,
) {
  if (!endpoint) {
    console.warn("NudgeProvider has no endpoint. The event was not sent.");
    return;
  }

  const facts = factsFrom(context);
  const payload: {
    nudge_id: string;
    action: EventAction;
    context?: Record<string, unknown>;
  } = { nudge_id: nudgeId, action };
  if (facts) payload.context = facts;

  // keepalive so a click that navigates away still leaves the browser.
  // same-origin so the session cookie can ride along. user_id is not in the JSON.
  const init: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    keepalive: true,
    body: JSON.stringify(payload),
  };

  try {
    void Promise.resolve(fetch(endpoint, init)).catch((err) => {
      console.warn("Nudge event could not be sent.", err);
    });
  } catch (err) {
    console.warn("Nudge event could not be sent.", err);
  }
}
