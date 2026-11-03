import { createContext } from "react";
import type { NudgeItem, NudgeRegistry } from "./types.js";

export type TrackAction = "click" | "dismiss";

export type NudgeApi = {
  items: NudgeItem[];
  registry: NudgeRegistry;
  /** Changes each time decide() returns a new list. Impression dedupe uses it. */
  resultId: number;
  impression: (nudgeId: string) => void;
  send: (nudgeId: string, action: TrackAction) => void;
  setAnchor: (nudgeId: string, node: HTMLElement | null) => void;
  getAnchor: (nudgeId: string) => HTMLElement | null;
};

export const NudgeContext = createContext<NudgeApi | null>(null);
