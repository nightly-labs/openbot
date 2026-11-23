import {
  type LiveActivityAction,
  type LiveActivityLink,
  readLiveActivityLink,
} from "@openbot/team-client/live-activity-props";
import type { OutsideTarget } from "../../workspace/model/outside-target";

export interface LiveActivityRequest {
  action: LiveActivityAction;
  command: string | null;
}

let listener: ((request: LiveActivityRequest) => void) | null = null;
let navigate: ((target: OutsideTarget | null, chatOpened?: boolean) => void) | null = null;
let pending: LiveActivityRequest | null = null;
let unopened: OutsideTarget | null = null;
let keyFor: ((serverId: string) => Uint8Array) | null = null;
let unchecked: string | null = null;

export function resetLiveActivityActions(): void {
  pending = null;
  unopened = null;
  unchecked = null;
  keyFor = null;
}

export function setLiveActivityLinkKeys(actionKey: (serverId: string) => Uint8Array): void {
  keyFor = actionKey;
  const path = unchecked;
  unchecked = null;
  if (path === null) return;
  const link = readLiveActivityLink(path, actionKey);
  if (link.type !== "action") return;
  receive(link);
  navigate?.(linkTarget(link));
}

export function onLiveActivityAction(receive: (request: LiveActivityRequest) => void): () => void {
  listener = receive;
  const waiting = pending;
  pending = null;
  if (waiting) receive(waiting);
  return () => {
    if (listener === receive) listener = null;
  };
}

export function setLiveActivityNavigator(
  open: (target: OutsideTarget | null, chatOpened?: boolean) => void,
): () => void {
  navigate = open;
  const waiting = unopened;
  unopened = null;
  if (waiting) open(waiting, true);
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

export function liveActivityRoute(path: string, initial = true): string | null {
  if (!keyFor && new URL(path).searchParams.has("sig")) {
    unchecked = path;
    return open(null, initial);
  }
  const link = readLiveActivityLink(path, keyFor ?? (() => null));
  if (link.type === "action") receive(link);
  return open(linkTarget(link), initial);
}

function receive(link: Extract<LiveActivityLink, { type: "action" }>): void {
  if (link.action.type === "open-agent") return;
  const request = { action: link.action, command: link.command };
  if (listener) listener(request);
  else pending = request;
}

function open(target: OutsideTarget | null, initial: boolean): string | null {
  if (initial || !navigate) {
    unopened = target?.threadId ? target : null;
    return target === null ? "/" : `/chat/${encodeURIComponent(target.agentId)}`;
  }
  navigate(target);
  return null;
}

function linkTarget(link: LiveActivityLink): OutsideTarget | null {
  switch (link.type) {
    case "list":
      return null;
    case "open":
      return { agentId: link.agentId, serverId: link.serverId, threadId: link.threadId };
    case "action":
      return { agentId: link.action.agentId, serverId: link.action.serverId, threadId: link.threadId };
  }
}
