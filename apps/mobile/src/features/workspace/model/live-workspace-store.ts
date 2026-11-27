import type { BrowserTakeoverRequest } from "@openbot/contracts/ipc";
import type { BrowserPermissionRequestState } from "@openbot/contracts/team-protocol/browser-permissions-v1";
import type { MobileBrowserTabs, MobileHttpSignIns } from "../../browser/model/browser-tabs";
import type { MobileAgentActivities } from "./agent-activity";
import type { MobileContextStates } from "./context-states";
import type { PendingApproval } from "./pending-approvals";
import type { MobileThreadWait } from "./thread-waits";
import type { TurnStepLines } from "./turn-step-lines";

export interface LiveWorkspaceState {
  activityByServer: Record<string, MobileAgentActivities>;
  contextByServer: Record<string, MobileContextStates>;
  threadWaitsByServer: Record<string, readonly MobileThreadWait[]>;
  turnLinesByServer: Record<string, TurnStepLines>;
  unreadAgentIds: string[];
  unreadCounts: Record<string, number>;
  firstUnreadMessageIds: Record<string, string | null>;
  browserRequests: Record<string, BrowserTakeoverRequest[]>;
  browserTabs: Record<string, MobileBrowserTabs>;
  browserPermissions: Record<string, readonly BrowserPermissionRequestState[]>;
  browserHttpSignIns: Record<string, MobileHttpSignIns>;
  approvalRequests: Record<string, readonly PendingApproval[]>;
}

export type LiveAgentKey =
  | "activityByServer"
  | "threadWaitsByServer"
  | "unreadAgentIds"
  | "unreadCounts"
  | "firstUnreadMessageIds";

type Listener = () => void;

function changedRecordKeys<Value>(
  previous: Readonly<Record<string, Value>> | undefined,
  next: Readonly<Record<string, Value>> | undefined,
  into: Set<string>,
) {
  if (previous === next) return;
  for (const key in previous) if (previous[key] !== next?.[key]) into.add(key);
  for (const key in next) if (!previous || !(key in previous)) into.add(key);
}

function waitsByAgent(waits: readonly MobileThreadWait[] | undefined) {
  const byAgent = new Map<string, MobileThreadWait[]>();
  for (const wait of waits ?? []) {
    const list = byAgent.get(wait.agentId);
    if (list) list.push(wait);
    else byAgent.set(wait.agentId, [wait]);
  }
  return byAgent;
}

function changedWaitAgents(
  previous: readonly MobileThreadWait[] | undefined,
  next: readonly MobileThreadWait[] | undefined,
  into: Set<string>,
) {
  if (previous === next) return;
  const before = waitsByAgent(previous);
  const after = waitsByAgent(next);
  for (const [agentId, waits] of before) {
    const kept = after.get(agentId);
    if (!kept || kept.length !== waits.length || kept.some((wait, index) => wait !== waits[index])) into.add(agentId);
  }
  for (const agentId of after.keys()) if (!before.has(agentId)) into.add(agentId);
}

function changedServerAgents<Value>(
  before: Readonly<Record<string, Value>>,
  after: Readonly<Record<string, Value>>,
  changedIn: (previous: Value | undefined, next: Value | undefined, into: Set<string>) => void,
  into: Set<string>,
) {
  const servers = new Set<string>();
  changedRecordKeys(before, after, servers);
  for (const serverId of servers) changedIn(before[serverId], after[serverId], into);
}

function changedLiveAgentIds(key: LiveAgentKey, before: LiveWorkspaceState, after: LiveWorkspaceState): Set<string> {
  const changed = new Set<string>();
  if (key === "activityByServer")
    changedServerAgents(before.activityByServer, after.activityByServer, changedRecordKeys, changed);
  else if (key === "threadWaitsByServer")
    changedServerAgents(before.threadWaitsByServer, after.threadWaitsByServer, changedWaitAgents, changed);
  else if (key === "unreadAgentIds") {
    const previous = new Set(before.unreadAgentIds);
    const next = new Set(after.unreadAgentIds);
    for (const agentId of previous) if (!next.has(agentId)) changed.add(agentId);
    for (const agentId of next) if (!previous.has(agentId)) changed.add(agentId);
  } else if (key === "unreadCounts") changedRecordKeys(before.unreadCounts, after.unreadCounts, changed);
  else changedRecordKeys(before.firstUnreadMessageIds, after.firstUnreadMessageIds, changed);
  return changed;
}

function isAgentKey(key: keyof LiveWorkspaceState): key is LiveAgentKey {
  return (
    key === "activityByServer" ||
    key === "threadWaitsByServer" ||
    key === "unreadAgentIds" ||
    key === "unreadCounts" ||
    key === "firstUnreadMessageIds"
  );
}

function addListener<Id>(listeners: Map<Id, Set<Listener>>, id: Id, listener: Listener) {
  let set = listeners.get(id);
  if (!set) {
    set = new Set();
    listeners.set(id, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0 && listeners.get(id) === set) listeners.delete(id);
  };
}

export class LiveWorkspaceStore {
  #state: LiveWorkspaceState = {
    activityByServer: {},
    contextByServer: {},
    threadWaitsByServer: {},
    turnLinesByServer: {},
    unreadAgentIds: [],
    unreadCounts: {},
    firstUnreadMessageIds: {},
    browserRequests: {},
    browserTabs: {},
    browserPermissions: {},
    browserHttpSignIns: {},
    approvalRequests: {},
  };
  readonly #listeners = new Set<Listener>();
  readonly #keyListeners = new Map<keyof LiveWorkspaceState, Set<Listener>>();
  readonly #agentListeners = new Map<LiveAgentKey, Map<string, Set<Listener>>>();

  get = () => this.#state;

  subscribe = (listener: Listener) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  subscribeKey(key: keyof LiveWorkspaceState, listener: Listener) {
    return addListener(this.#keyListeners, key, listener);
  }

  subscribeAgent(key: LiveAgentKey, agentId: string, listener: Listener) {
    let byAgent = this.#agentListeners.get(key);
    if (!byAgent) {
      byAgent = new Map();
      this.#agentListeners.set(key, byAgent);
    }
    return addListener(byAgent, agentId, listener);
  }

  update<Key extends keyof LiveWorkspaceState>(
    key: Key,
    change: (current: LiveWorkspaceState[Key]) => LiveWorkspaceState[Key],
  ) {
    const before = this.#state;
    const current = before[key];
    const next = change(current);
    if (next === current) return;
    const after: LiveWorkspaceState = { ...before, [key]: next };
    this.#state = after;
    for (const listener of this.#listeners) listener();
    const keyListeners = this.#keyListeners.get(key);
    if (keyListeners) for (const listener of [...keyListeners]) listener();
    if (!isAgentKey(key)) return;
    const byAgent = this.#agentListeners.get(key);
    if (!byAgent?.size) return;
    for (const agentId of changedLiveAgentIds(key, before, after)) {
      const listeners = byAgent.get(agentId);
      if (listeners) for (const listener of [...listeners]) listener();
    }
  }
}
