import { useContext, useEffect, useRef } from "react";
import { NudgeContext } from "./context.js";

export type NudgeTracking = {
  click: () => void;
  dismiss: () => void;
};

/**
 * Records one impression for this decide() result the first time the nudge
 * is actually on screen. Later draws of the same result do not count.
 * `click` and `dismiss` send those actions. Dismiss also removes the nudge
 * from the provider list right away. Neither throws into the page.
 */
export function useNudgeTracking(nudgeId: string | undefined): NudgeTracking {
  const api = useContext(NudgeContext);
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    const current = apiRef.current;
    if (!current) {
      console.warn(
        "useNudgeTracking was used outside NudgeProvider. Clicks will not be recorded.",
      );
      return;
    }
    if (!nudgeId) return;
    const anchor = current.getAnchor(nudgeId);
    if (!anchor) return;
    return observeVisible(anchor, () => {
      apiRef.current?.impression(nudgeId);
    });
  }, [nudgeId, api?.resultId]);

  return {
    click() {
      if (!nudgeId) return;
      apiRef.current?.send(nudgeId, "click");
    },
    dismiss() {
      if (!nudgeId) return;
      apiRef.current?.send(nudgeId, "dismiss");
    },
  };
}

/**
 * Call `onVisible` once the anchor's content is on screen and the tab is visible.
 * Browsers use IntersectionObserver. A test DOM with no observer counts a
 * connected node that is not `display: none` or `visibility: hidden`.
 */
function observeVisible(anchor: HTMLElement, onVisible: () => void): () => void {
  let stopped = false;
  const stop = () => {
    stopped = true;
  };

  const target = visibleTarget(anchor);
  if (!target || !target.isConnected) return stop;

  const fire = () => {
    if (stopped) return;
    if (document.visibilityState === "hidden") return;
    if (isCssHidden(target)) return;
    stopped = true;
    onVisible();
  };

  if (typeof IntersectionObserver === "function") {
    let intersecting = false;
    const observer = new IntersectionObserver((entries) => {
      intersecting = entries.some((entry) => entry.isIntersecting);
      if (intersecting) fire();
    });
    observer.observe(target);
    const onVisibility = () => {
      if (intersecting) fire();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }

  if (document.visibilityState === "hidden") {
    const onVisibility = () => fire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }

  fire();
  return stop;
}

/** A modal is drawn on document.body, so it is not a child of the slot anchor. */
function visibleTarget(anchor: HTMLElement): Element | null {
  if (anchor.style.display !== "contents") return anchor;
  if (anchor.firstElementChild) return anchor.firstElementChild;
  const id = anchor.dataset.nudgeId;
  if (!id) return null;
  const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(id) : id;
  return document.querySelector(`[data-nudge-portal="${escaped}"]`);
}

function isCssHidden(element: Element): boolean {
  let node: Element | null = element;
  while (node && node instanceof Element) {
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return true;
    node = node.parentElement;
  }
  return false;
}
