import { isOneOf } from "./runtime-values";

/** Local host configuration IPC only. Released Team API busy-message modes remain queue and steer. */
export const CUSTOM_MESSAGE_MODES = ["queue", "steer", "thread"] as const;
export type CustomMessageMode = (typeof CUSTOM_MESSAGE_MODES)[number];

export function isCustomMessageMode(value: unknown): value is CustomMessageMode {
  return isOneOf(CUSTOM_MESSAGE_MODES, value);
}

export interface CustomMessageRoutingSettings {
  available: boolean;
  defaultMode: CustomMessageMode;
  /** Null follows the host default. This record does not enter an exported agent or Team payload. */
  agents: Record<string, CustomMessageMode | null>;
}

export interface SetCustomMessageRoutingInput {
  /** Null is valid only with agentIds, to follow the host default. */
  mode: CustomMessageMode | null;
  /** Omitted changes the host default; supplied changes only the named local agents. */
  agentIds?: string[];
}
