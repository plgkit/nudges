import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ComponentType,
  type ReactNode,
} from "react";
import { NudgeContext } from "./context.js";
import type { NudgeItem, NudgeRegistry } from "./types.js";

const anchorStyle = { display: "contents" } as const;

type ReadyItem = {
  item: NudgeItem;
  Component: ComponentType<any>;
  renderProps: Record<string, unknown>;
};

export function NudgeSurface({ surface }: { surface: string }) {
  const api = useContext(NudgeContext);
  const plan = useMemo(
    () => classify(api?.items ?? [], surface, api?.registry ?? {}),
    [api, surface],
  );
  const hasProvider = api !== null;
  const warningText = plan.messages.join("\n");

  useEffect(() => {
    if (!hasProvider) {
      console.warn(
        `NudgeSurface for "${surface}" is outside NudgeProvider. Showing nothing.`,
      );
      return;
    }
    if (!warningText) return;
    for (const message of warningText.split("\n")) console.warn(message);
  }, [hasProvider, surface, warningText]);

  if (!api) return null;

  return (
    <>
      {plan.ready.map(({ item, Component, renderProps }) => (
        <NudgeAnchor key={item.id} nudgeId={item.id} setAnchor={api.setAnchor}>
          {/* nudge_id is the message id. It wins if render_props also has nudge_id. */}
          <Component {...renderProps} nudge_id={item.id} />
        </NudgeAnchor>
      ))}
    </>
  );
}

function NudgeAnchor({
  nudgeId,
  setAnchor,
  children,
}: {
  nudgeId: string;
  setAnchor: (nudgeId: string, node: HTMLElement | null) => void;
  children: ReactNode;
}) {
  const setAnchorRef = useRef(setAnchor);
  setAnchorRef.current = setAnchor;
  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      setAnchorRef.current(nudgeId, node);
    },
    [nudgeId],
  );
  return (
    <div ref={ref} data-nudge-id={nudgeId} style={anchorStyle}>
      {children}
    </div>
  );
}

function classify(
  items: NudgeItem[],
  surface: string,
  registry: NudgeRegistry,
): { ready: ReadyItem[]; messages: string[] } {
  const ready: ReadyItem[] = [];
  const messages: string[] = [];
  for (const item of items) {
    if (!item || item.surface !== surface) continue;
    if (!item.component) {
      messages.push(`Nudge "${item.id}" has no component name. Showing nothing.`);
      continue;
    }
    const Component = registry[item.component];
    if (!isComponent(Component)) {
      messages.push(
        `Nudge "${item.id}" names component "${item.component}", which is not in the registry. Showing nothing.`,
      );
      continue;
    }
    if (!isProps(item.render_props)) {
      messages.push(`Nudge "${item.id}" has no render_props. Showing nothing.`);
      continue;
    }
    ready.push({ item, Component, renderProps: item.render_props });
  }
  return { ready, messages };
}

function isProps(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const MEMO_TYPE = Symbol.for("react.memo");
const FORWARD_REF_TYPE = Symbol.for("react.forward_ref");

function isComponent(value: unknown): value is ComponentType<any> {
  if (typeof value === "function") return true;
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { $$typeof?: unknown }).$$typeof;
  return type === MEMO_TYPE || type === FORWARD_REF_TYPE;
}
