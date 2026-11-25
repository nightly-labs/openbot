import type { BrowserTakeoverRequest } from "@openbot/contracts/ipc";
import type { BrowserPermissionRequestState } from "@openbot/contracts/team-protocol/browser-permissions-v1";
import type { MobileBrowserTabs } from "@/features/browser/model/browser-tabs";
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
  approvalRequests: Record<string, readonly PendingApproval[]>;
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
    approvalRequests: {},
  };
  readonly #listeners = new Set<() => void>();

  get = () => this.#state;

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  update<Key extends keyof LiveWorkspaceState>(
    key: Key,
    change: (current: LiveWorkspaceState[Key]) => LiveWorkspaceState[Key],
  ) {
    const current = this.#state[key];
    const next = change(current);
    if (next === current) return;
    this.#state = { ...this.#state, [key]: next };
    for (const listener of this.#listeners) listener();
  }
}
