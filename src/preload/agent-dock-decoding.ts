// What main sends for the agent dock window: the presentation it shows and the actions that the main
// renderer does.

import {
  type AgentDockAction,
  type AgentDockDisplayInfo,
  type AgentDockOffset,
  type AgentDockPresentation,
  isAgentDockAction,
  isAgentDockDisplayInfoList,
  isAgentDockOffset,
  isAgentDockPresentation,
} from "@openbot/contracts/ipc";

/** Null hides the dock window. */
export function decodeAgentDockPresentation(value: unknown): AgentDockPresentation | null {
  if (value === null) return null;
  if (!isAgentDockPresentation(value)) throw new Error("Invalid agent dock presentation.");
  return value;
}

export function decodeAgentDockAction(value: unknown): AgentDockAction {
  if (isAgentDockAction(value)) return value;
  throw new Error("Invalid agent dock action.");
}

export function decodeAgentDockOffset(value: unknown): AgentDockOffset {
  if (isAgentDockOffset(value)) return value;
  throw new Error("Invalid agent dock position.");
}

export function decodeAgentDockDisplays(value: unknown): AgentDockDisplayInfo[] {
  if (isAgentDockDisplayInfoList(value)) return value;
  throw new Error("Invalid agent dock display list.");
}
