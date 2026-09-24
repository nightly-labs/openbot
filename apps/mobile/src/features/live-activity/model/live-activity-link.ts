import type { DynamicIslandAction } from "@openbot/contracts/ipc";

/** What a tap on the activity or on one of its buttons does after the app opens. */
export type LiveActivityAction = Extract<
  DynamicIslandAction,
  { type: "open-agent" | "open-failure" | "answer-prompt" | "respond-approval" }
>;

/**
 * ActivityKit fixes the URL of an activity when it starts, but the activity shows different chats
 * over its life. So the URL names no chat, and the app does the tap action of the current state.
 */
export const LIVE_ACTIVITY_URL = "openbot://live-activity";
/** Opens the chat list. It starts no action, so it needs no token. */
export const LIVE_ACTIVITY_LIST_URL = `${LIVE_ACTIVITY_URL}?list=1`;

let tapAction: LiveActivityAction | null = null;
/** Button URLs carry only a random token. Other apps can open `openbot://` links but cannot guess one. */
let buttons = new Map<string, LiveActivityAction>();
let listener: ((action: LiveActivityAction) => void) | null = null;
let navigate: ((agentId: string | null) => void) | null = null;
let pending: LiveActivityAction | null = null;

/**
 * Sets the actions of the state the activity shows now and returns the URL of each button. A button
 * keeps its URL while its action stays, so an unchanged state gives unchanged props. Actions of
 * earlier states stop working, so an old button cannot answer a newer request.
 */
export function setLiveActivityActions(
  tap: LiveActivityAction | null,
  actions: readonly LiveActivityAction[],
  newToken: () => string,
): string[] {
  tapAction = tap;
  const tokens = new Map([...buttons].map(([token, action]) => [JSON.stringify(action), token]));
  const next = new Map<string, LiveActivityAction>();
  const urls = actions.map((action) => {
    const token = tokens.get(JSON.stringify(action)) ?? newToken();
    next.set(token, action);
    return `${LIVE_ACTIVITY_URL}?${new URLSearchParams({ action: token })}`;
  });
  buttons = next;
  return urls;
}

/** Sign-out removes the workspace, so no action of it can run after. */
export function resetLiveActivityActions(): void {
  tapAction = null;
  buttons = new Map();
  pending = null;
}

/** Receives the actions that need the host. A listener that starts later receives the last one. */
export function onLiveActivityAction(receive: (action: LiveActivityAction) => void): () => void {
  listener = receive;
  const waiting = pending;
  pending = null;
  if (waiting) receive(waiting);
  return () => {
    if (listener === receive) listener = null;
  };
}

/** Opens a chat, or the chat list for `null`, while the app runs. */
export function setLiveActivityNavigator(open: (agentId: string | null) => void): () => void {
  navigate = open;
  return () => {
    if (navigate === open) navigate = null;
  };
}

export function isLiveActivityLink(path: string): boolean {
  try {
    const url = new URL(path);
    return url.protocol === "openbot:" && url.host === "live-activity";
  } catch {
    return false;
  }
}

/**
 * Starts the action of a Live Activity link and returns the route to open. A cold start knows no
 * action yet, and an unknown token can come from another app, so both open the chat list only.
 *
 * While the app runs, a returned route pushes a new screen, so a chat that is open already mounts
 * again and loads again. So the running app opens the route itself and this returns `null`.
 */
export function liveActivityRoute(path: string, initial = true): string | null {
  const agentId = targetAgent(path);
  if (initial || !navigate) return agentId === null ? "/" : `/chat/${encodeURIComponent(agentId)}`;
  navigate(agentId);
  return null;
}

function targetAgent(path: string): string | null {
  const params = new URL(path).searchParams;
  if (params.has("list")) return null;
  const token = params.get("action");
  const action = token === null ? tapAction : (buttons.get(token) ?? null);
  if (!action) return null;
  // The tap URL has no token, and any app can open it, so it only opens a chat. The token stays
  // after a tap: a cancelled or failed answer leaves the same state, and the button must still work.
  if (token !== null && action.type !== "open-agent") {
    if (listener) listener(action);
    else pending = action;
  }
  return action.agentId;
}
