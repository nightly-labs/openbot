import {
  type LiveActivityAction,
  type LiveActivityLink,
  readLiveActivityLink,
} from "@openbot/team-client/live-activity-props";

/** An action from a signed button link. `command` is the command that Approve runs, shown again first. */
export interface LiveActivityRequest {
  action: LiveActivityAction;
  command: string | null;
}

let listener: ((request: LiveActivityRequest) => void) | null = null;
let navigate: ((agentId: string | null) => void) | null = null;
let pending: LiveActivityRequest | null = null;
/** The action key of each host. `null` before the phone secret loads. */
let keyFor: ((serverId: string) => Uint8Array) | null = null;
/** A button link that came before the keys loaded. It is checked when they load. */
let unchecked: string | null = null;

/** Sign-out removes the workspace, so no action of it can run after. */
export function resetLiveActivityActions(): void {
  pending = null;
  unchecked = null;
  keyFor = null;
}

/** The keys that check the button links. A link from before they load is checked then. */
export function setLiveActivityLinkKeys(actionKey: (serverId: string) => Uint8Array): void {
  keyFor = actionKey;
  const path = unchecked;
  unchecked = null;
  if (path === null) return;
  const link = readLiveActivityLink(path, actionKey);
  if (link.type !== "action") return;
  receive(link);
  navigate?.(link.action.agentId);
}

/** Receives the actions that need the host. A listener that starts later receives the last one. */
export function onLiveActivityAction(receive: (request: LiveActivityRequest) => void): () => void {
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
 * Starts the action of a Live Activity link and returns the route to open. Any app can open an
 * `openbot://` link, so only a link with a valid signature starts an action, and an other link opens
 * a chat or the chat list only.
 *
 * While the app runs, a returned route pushes a new screen, so a chat that is open already mounts
 * again and loads again. So the running app opens the route itself and this returns `null`.
 */
export function liveActivityRoute(path: string, initial = true): string | null {
  if (!keyFor && new URL(path).searchParams.has("sig")) {
    // At launch the link can come before the keys load. It is checked when they do.
    unchecked = path;
    return open(null, initial);
  }
  const link = readLiveActivityLink(path, keyFor ?? (() => null));
  if (link.type === "action") receive(link);
  return open(targetAgent(link), initial);
}

function receive(link: Extract<LiveActivityLink, { type: "action" }>): void {
  // A tap on the same button again sends the answer again. The host refuses an answer to a request
  // that is gone, and a cancelled or failed answer leaves the same state, so the button still works.
  if (link.action.type === "open-agent") return;
  const request = { action: link.action, command: link.command };
  if (listener) listener(request);
  else pending = request;
}

function open(agentId: string | null, initial: boolean): string | null {
  if (initial || !navigate) return agentId === null ? "/" : `/chat/${encodeURIComponent(agentId)}`;
  navigate(agentId);
  return null;
}

function targetAgent(link: LiveActivityLink): string | null {
  switch (link.type) {
    case "list":
      return null;
    case "open":
      return link.agentId;
    case "action":
      return link.action.agentId;
  }
}
