import type { ComponentType } from "react";

/** One row from decide(). `id` is the message file name without `.yml`. */
export type NudgeItem = {
  id: string;
  surface: string;
  component?: string;
  render_props?: Record<string, unknown>;
};

/**
 * Asks your backend what to show. The provider calls
 * `decide(location, context)` with the page location and the flat page
 * facts (`user_id` left out). Return the list your backend already chose.
 * This package does not pick messages.
 */
export type DecideFn = (
  location: string,
  context: Record<string, unknown> | undefined,
) => Promise<NudgeItem[]>;

/**
 * Component name to React component. `any` is deliberate: each component
 * has its own props, and React's prop check would reject a specific
 * component registered under a shared props type.
 */
export type NudgeRegistry = Record<string, ComponentType<any>>;
