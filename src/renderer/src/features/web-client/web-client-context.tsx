import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentApproval,
  AgentColorEntry,
  AgentContextState,
  AgentEvent,
  AgentRuntimeApproval,
  AgentStatus,
  AttachmentSummary,
  BrowserControlState,
  BrowserTab,
  BrowserTakeoverRequest,
  ChannelSummary,
  ChatColors,
  ClientAgentModelOption,
  ClientAgentSummary,
  ConversationMessage,
  ConversationPage,
  ConversationReadState,
  HiddenAgent,
  HostedServerIssue,
  HostedServerSleep,
  HostedServerStart,
  MemberChatColorEntry,
  ProviderModelSourceEntry,
  QueueSnapshot,
  ReadMediaApprovalInput,
  RespondToApprovalInput,
  RespondToCreditsHoldInput,
  RespondToMediaApprovalInput,
  RespondToPromptInput,
  SidebarLayoutAction,
  SidebarLayoutSnapshot,
  TeamPresenceSnapshot,
  TeamRealtimeEvent,
} from "@openbot/contracts/ipc";
import { canAdministerServer, openExchangesOutside, withModelSources } from "@openbot/contracts/ipc";
import {
  AGENT_ACTIVE_QUEUES_CAPABILITY,
  AGENT_ACTIVE_QUEUES_LIMIT,
  type AgentActiveQueues,
} from "@openbot/contracts/team-protocol/agent-active-queues-v1";
import {
  AGENT_COLORS_CAPABILITY,
  AGENT_HIDDEN_CAPABILITY,
  CHAT_COLORS_CAPABILITY,
} from "@openbot/contracts/team-protocol/current";
import { FOCUS_USE_CAPABILITY } from "@openbot/contracts/team-protocol/focus-use-v1";
import { HOST_APPEARANCE_CAPABILITY, type ServerAppearance } from "@openbot/contracts/team-protocol/host-appearance-v1";
import { HOST_RESTART_CAPABILITY } from "@openbot/contracts/team-protocol/host-restart-v1";
import { MESSAGE_DELETE_CAPABILITY } from "@openbot/contracts/team-protocol/message-delete-v1";
import { SIDEBAR_PINS_CAPABILITY } from "@openbot/contracts/team-protocol/sidebar-pins-v1";
import { cleanAgentMessageText } from "@openbot/team-client/agent-message-text";
import { createFocusUsePing } from "@openbot/team-client/focus-use";
import { WAKE_RECONNECT_DELAY_MS } from "@openbot/team-client/hosted-server-wake";
import type { RemoteTeamHost } from "@openbot/team-client/remote-directory";
import {
  createRemoteConnectionRecovery,
  isSafeConnectionError,
  type RemoteRecoveryStatus,
} from "@openbot/team-client/remote-recovery";
import {
  approvalIsCut,
  keepWholeApprovals,
  reconcilePendingRequests,
  withWholeApproval,
} from "@openbot/team-client/runtime-attention";
import { markRemoteSync } from "@openbot/team-client/sync-profile";
import { duplicateSection as duplicateSectionWith } from "@openbot/ui/features/sidebar/duplicate-section";
import { currentText } from "@openbot/ui/text";
import { errorReference, type UserErrorDetails } from "@openbot/user-errors";
import { createEffect, createMemo, createSignal, createStore, onSettled } from "solid-js";
import { toAgentProfile } from "../../app-message-projection";
import { backgroundWorkKey } from "../conversation/background-work-key";
import { messagePromptRequestKey, promptRequestKey } from "../conversation/conversation-keys";
import {
  mergeConversationPage,
  missingReplyOriginals,
  windowedSnapshotMessages,
} from "../conversation/conversation-merge";
import { latestIncomingConversationMessage } from "../conversation/conversation-read-state";
import type { PromptAnswerOptions } from "../conversation/conversation-types";
import { appendTurnStepLine, type TurnStepLines } from "../conversation/turn-step-lines";
import {
  deleteRemoteWorkspaceFrame,
  deleteRemoteWorkspaceFrames,
  readRemoteWorkspaceFrame,
  saveRemoteFrameUnreadCounts,
  saveRemoteWorkspaceFrame,
} from "../servers/remote-workspace-frame";
import { followsServerUpdate } from "../servers/server-update-flow";
import { createSidebarPreferences } from "../sidebar/sidebar-preferences";
import { defaultSidebarLayout } from "../sidebar/sidebar-sections";
import { createHostRestartToasts, type HostRestartView } from "../updates/host-restart-toast";
import { deleteCachedWorkflows, keepCachedWorkflows } from "../workflows/workflow-cache";
import {
  agentPictureMark,
  deleteSavedAgentPictures,
  deleteSavedServerPictures,
  keepSavedAgentPictures,
  readSavedAgentPicture,
  saveAgentPicture,
} from "./web-agent-pictures";
import { readCachedWebHosts, writeCachedWebHosts } from "./web-host-cache";
import type { WebHostNotice } from "./web-host-connections";
import { createWebHostLifecycle } from "./web-host-lifecycle";
import { WebHostOtherTabError, type WebHostState } from "./web-host-lock";
import {
  createWebWorkspaceRuntime,
  WebHostConnectionError,
  WebHostIncompatibleError,
  type WebRuntimeEvents,
  type WebWorkspaceRuntime,
} from "./web-runtime";
import { orderWebHosts, readWebServerOrder, writeWebServerOrder } from "./web-server-order";
import { readWebServerSelection, writeWebServerSelection } from "./web-server-selection";

interface WebConversation {
  page: ConversationPage | null;
  missingReferences?: Record<string, true>;
  draft: string;
  attachments: AttachmentSummary[];
  loading: boolean;
  error?: string | null;
  trimmed?: boolean;
  olderError?: string | null;
  around?: boolean;
}

const LATEST_PAGE_SIZE = 50;
const PRELOADED_AGENTS = 3;
const PRELOAD_CONCURRENCY = 2;
const EVENT_READS_INTERVAL_MS = 1_000;

function trimToLatestPage(conversation: WebConversation): void {
  const page = conversation.page;
  if (!page) return;
  conversation.trimmed = true;
  conversation.around = false;
  if (page.messages.length <= LATEST_PAGE_SIZE) return;
  const kept = page.messages.slice(-LATEST_PAGE_SIZE);
  const removedById = new Map(page.messages.slice(0, -LATEST_PAGE_SIZE).map((message) => [message.id, message]));
  const references: Record<string, ConversationMessage> = {};
  for (const message of kept) {
    const originalId = message.replyToMessageId;
    const original = originalId ? (removedById.get(originalId) ?? page.references[originalId]) : undefined;
    if (originalId && original) references[originalId] = original;
  }
  page.messages = kept;
  page.references = references;
  page.pageInfo = { ...page.pageInfo, hasOlder: true };
}

interface WebWorkspaceState {
  hosts: RemoteTeamHost[];
  host: RemoteTeamHost | null;
  agents: ClientAgentSummary[];
  agentsLoaded: boolean;
  agentsFromFrame: boolean;
  frameChannels: ChannelSummary[];
  selectedId: string | null;
  conversations: Record<string, WebConversation>;
  queues: Record<string, QueueSnapshot>;
  approvals: Array<AgentApproval | AgentRuntimeApproval>;
  prompts: Array<Extract<AgentEvent, { type: "prompt" }>>;
  progress: Record<string, { turnId: string; detail: string; running?: boolean; activity?: string }>;
  takeovers: BrowserTakeoverRequest[];
  contextStates: Record<string, AgentContextState>;
  threadContextStates: Record<string, AgentContextState>;
  backgroundWork: Record<string, number>;
  browserTabs: BrowserTab[];
  noticedBrowserTabIds: string[] | null;
  activeBrowserTabId: string | null;
  browserControlState: BrowserControlState;
  presence: TeamPresenceSnapshot | null;
  capabilities: string[];
  status: "connecting" | "online" | "offline";
  hostedSleep: HostedServerSleep | null;
  hostedIssue: HostedServerIssue | null;
  hostedStart: HostedServerStart | null;
  connectionError: UserErrorDetails | null;
  hostOffline: boolean;
  otherTab: boolean;
  recovery: RemoteRecoveryStatus | null;
  workspaceLoaded: boolean;
  synced: boolean;
  panelsFailed: boolean;
  panelsLoading: boolean;
  agentStatus: AgentStatus | null;
  models: ClientAgentModelOption[];
  hostRestart: { state: "waiting" | "restarting"; version: string | null } | null;
  restartReady: boolean;
  hostStates: Record<string, WebHostState>;
  incompatibility: {
    hostId: string;
    code: WebHostIncompatibleError["code"];
    message: string;
    hostAppVersion: string;
    hostProtocol: { minimum: number; maximum: number };
  } | null;
  hostsLoaded: boolean;
  hostsLoading: boolean;
  hostsError: UserErrorDetails | null;
  revocationRevision: number;
  error: UserErrorDetails | null;
  busy: boolean;
  uploading: boolean;
  hiddenIds: string[];
  memberId: string | null;
  duplicatingAgentIds: string[];
  sidebarLayout: SidebarLayoutSnapshot;
  userHiddenAgents: HiddenAgent[];
  agentColors: AgentColorEntry[];
  chatColors: ChatColors;
  reads: Record<string, ConversationReadState>;
}

export type WebRuntimeFactory = (
  accountId: string,
  events: WebRuntimeEvents,
  accountFetch: typeof fetch,
) => WebWorkspaceRuntime;

export type WebWorkspace = ReturnType<typeof createWebWorkspace>;

export function createWebWorkspace(
  props: {
    accountId: string;
    accountFetch: typeof fetch;
    onSessionCheck: () => Promise<void>;
    accountSessionEnded?: () => boolean;
    createRuntime?: WebRuntimeFactory | undefined;
  },
  hooks: {
    onStatus?: (status: AgentStatus) => void;
  } = {},
) {
  const cachedHosts = readCachedWebHosts(props.accountId);
  const [state, setState] = createStore<WebWorkspaceState>({
    hosts: cachedHosts,
    host: null,
    agents: [],
    agentsLoaded: false,
    agentsFromFrame: false,
    frameChannels: [],
    selectedId: null,
    conversations: {},
    queues: {},
    approvals: [],
    prompts: [],
    progress: {},
    takeovers: [],
    contextStates: {},
    threadContextStates: {},
    backgroundWork: {},
    browserTabs: [],
    noticedBrowserTabIds: null,
    activeBrowserTabId: null,
    browserControlState: { sessions: [] },
    presence: null,
    capabilities: [],
    status: "offline",
    hostedSleep: null,
    hostedIssue: null,
    hostedStart: null,
    connectionError: null,
    hostOffline: false,
    otherTab: false,
    recovery: null,
    workspaceLoaded: false,
    synced: false,
    panelsFailed: false,
    panelsLoading: false,
    agentStatus: null,
    models: [],
    hostRestart: null,
    restartReady: false,
    hostStates: {},
    incompatibility: null,
    hostsLoaded: cachedHosts.length > 0,
    hostsLoading: false,
    hostsError: null,
    revocationRevision: 0,
    error: null,
    busy: false,
    uploading: false,
    hiddenIds: [],
    memberId: null,
    duplicatingAgentIds: [],
    sidebarLayout: defaultSidebarLayout(),
    userHiddenAgents: [],
    agentColors: [],
    chatColors: { agents: [], members: [] },
    reads: {},
  });
  const [stepLines, setStepLines] = createSignal<TurnStepLines>({});
  let generation = 0;
  let restartCapable = false;
  let selectedId: string | null = null;
  let hostId: string | null = null;
  let disposed = false;
  let running = false;
  let pendingReload = false;
  let reloadPromise: Promise<void> | null = null;
  let hostsRefreshPromise: Promise<void> | null = null;
  const leftHostIds = new Set<string>();
  let acceptedInvite: { inviteUrl: string; host: RemoteTeamHost } | null = null;
  let revokedReconnect = false;
  let syncedAt = 0;
  const queueLoads = new Map<string, { generation: number; again: boolean }>();
  const queueRevisions = new Map<string, number>();
  const partialQueues = new Set<string>();
  const queueListPending = new Set<string>();
  let queueListRunning: number | null = null;
  const readWrites = new Map<string, Promise<void>>();
  const conversationReads = new Map<string, number>();
  const aroundReads = new Map<string, number>();
  const heldDeltas = new Map<string, Array<Extract<AgentEvent, { type: "conversation-delta" }>>>();
  const hostEventListeners = new Set<(event: AgentEvent | TeamRealtimeEvent) => void>();
  let connectionPromise: { hostId: string; opened: boolean; promise: Promise<void> } | null = null;
  let recoveryBlocked = false;
  let recovery = makeRecovery();
  function makeRecovery() {
    return createRemoteConnectionRecovery(
      async () => {
        const host = state.host;
        if (!host || document.hidden) return;
        await attemptConnection(host);
        if (state.status !== "online") throw new Error(currentText().t("webClient.notice.connecting"));
      },
      noteConnectionFailure,
      (status) => {
        if (!disposed)
          setState((draft) => {
            draft.recovery = status;
          });
      },
      () => (state.hostedSleep === "waking" ? WAKE_RECONNECT_DELAY_MS : null),
    );
  }
  function noteConnectionFailure(error: unknown) {
    if (disposed || state.connectionError || !errorReference(error)) return;
    const text = currentText();
    setState((draft) => {
      draft.connectionError = text.errorDetails(
        error,
        text.t("server.connection.reconnecting", { name: draft.host?.name ?? "" }),
      );
    });
  }
  function recover() {
    if (disposed || !hostId || recoveryBlocked) return;
    recovery.offline();
    recovery.setActive(!document.hidden);
  }
  function recoverNow() {
    if (disposed || !hostId || recoveryBlocked) return;
    if (state.recovery?.phase !== "waiting" && state.recovery?.phase !== "cooldown") return recover();
    recovery.refresh();
    recovery.setActive(!document.hidden);
  }
  const hostLifecycle = createWebHostLifecycle({
    accountFetch: props.accountFetch,
    hostId: () => hostId,
    disposed: () => disposed,
    status: () => state.status,
    hostedSleep: () => state.hostedSleep,
    setHostedSleep,
    setIssue: (issue) =>
      setState((draft) => {
        draft.hostedIssue = issue;
      }),
    setStart: (start) =>
      setState((draft) => {
        draft.hostedStart = start;
      }),
    suspend: () => {
      recoveryBlocked = true;
      recovery.suspend();
    },
    recover: () => {
      recoveryBlocked = false;
      recovery.refresh();
      recover();
    },
  });
  const hostNoticeListeners = new Set<(hostId: string, event: WebHostNotice, agents: ClientAgentSummary[]) => void>();
  const wholeApprovalReads = new Set<string>();
  let promptListRead: "idle" | "reading" | "again" = "idle";
  const resolvedDuringPromptListRead = new Set<string>();
  let listedPrompts: { generation: number; prompts: Array<Extract<AgentEvent, { type: "prompt" }>> } = {
    generation,
    prompts: [],
  };
  function withListedPrompts(prompts: Array<Extract<AgentEvent, { type: "prompt" }>>) {
    if (listedPrompts.generation !== generation) return prompts;
    const known = new Set(prompts.map((item) => String(item.requestId)));
    const missing = listedPrompts.prompts.filter((prompt) => !known.has(String(prompt.requestId)));
    return missing.length > 0 ? [...prompts, ...missing] : prompts;
  }
  function forgetListedPrompt(requestId: string | number): void {
    if (promptListRead !== "idle") resolvedDuringPromptListRead.add(String(requestId));
    listedPrompts.prompts = listedPrompts.prompts.filter((prompt) => String(prompt.requestId) !== String(requestId));
  }
  function readListedPrompts(): void {
    const list = runtime.listPendingPrompts;
    if (!list) return;
    if (promptListRead !== "idle") {
      promptListRead = "again";
      return;
    }
    promptListRead = "reading";
    resolvedDuringPromptListRead.clear();
    const current = generation;
    void list()
      .then((prompts) => {
        if (disposed || current !== generation) return;
        listedPrompts = {
          generation: current,
          prompts: prompts
            .filter((prompt) => !resolvedDuringPromptListRead.has(String(prompt.requestId)))
            .map((prompt) => ({ ...prompt, type: "prompt" as const })),
        };
        setState((draft) => {
          draft.prompts = withListedPrompts(draft.prompts);
        });
      })
      .catch(() => undefined)
      .finally(() => {
        const again = promptListRead === "again";
        promptListRead = "idle";
        if (again && !disposed) readListedPrompts();
      });
  }
  function readWholeApprovals(): void {
    const read = runtime.readPendingApproval;
    if (!read) return;
    const current = generation;
    for (const approval of state.approvals.filter(approvalIsCut)) {
      const key = JSON.stringify([hostId, approval.agentId, approval.turnId, approval.requestId]);
      if (wholeApprovalReads.has(key)) continue;
      wholeApprovalReads.add(key);
      void read({ agentId: approval.agentId, requestId: approval.requestId }).then(
        (whole) => {
          if (disposed) return;
          if (!whole || current !== generation) {
            wholeApprovalReads.delete(key);
            return;
          }
          setState((draft) => {
            draft.approvals = [...withWholeApproval(draft.approvals, whole)];
          });
        },
        () => wholeApprovalReads.delete(key),
      );
    }
  }
  let hostStatus: AgentStatus | null = null;
  let hostSources: { hostId: string | null; sources: ProviderModelSourceEntry[] } = { hostId: null, sources: [] };
  let sourceRead = 0;
  function applyHostStatus(status: AgentStatus): void {
    hostStatus = status;
    const current = hostId;
    hooks.onStatus?.(withModelSources(status, hostSources.hostId === current ? hostSources.sources : []));
    if (!runtime.modelSources) return;
    const read = ++sourceRead;
    runtime
      .modelSources()
      .then((sources) => {
        if (disposed || read !== sourceRead || current !== hostId || !hostStatus) return;
        const previous = hostSources.hostId === current ? hostSources.sources : [];
        hostSources = { hostId: current, sources };
        if (JSON.stringify(previous) !== JSON.stringify(sources))
          hooks.onStatus?.(withModelSources(hostStatus, sources));
      })
      .catch(() => undefined);
  }
  const runtime = (props.createRuntime ?? createWebWorkspaceRuntime)(
    props.accountId,
    {
      accountChanged: props.onSessionCheck,
      serversChanged: retryHosts,
      accessDenied(id, error) {
        if (!disposed && id === hostId) blockAccess(error);
      },
      hostNotice(id, event, agents) {
        if (disposed) return;
        for (const listener of hostNoticeListeners) listener(id, event, agents);
      },
      hostState(id, hostState) {
        if (!disposed)
          setState((draft) => {
            draft.hostStates[id] = hostState;
          });
      },
      hostSessionRevoked: () => void retryHosts(),
      hostTaken(id) {
        if (disposed || id !== hostId) return;
        generation += 1;
        restartCapable = false;
        hostLifecycle.endSleep();
        recoveryBlocked = true;
        recovery.suspend();
        setState((draft) => {
          draft.otherTab = true;
          draft.status = "offline";
          draft.restartReady = false;
          draft.connectionError = null;
        });
      },
      connection(update) {
        if (disposed || update.hostId !== hostId) return;
        if (recoveryBlocked && update.state === "offline" && !update.code) return;
        const unavailable =
          (update.state === "offline" || update.hostOffline === true) && !update.code && !state.hostRestart;
        setState((draft) => {
          if (update.state !== "online") draft.status = update.state;
          draft.restartReady = update.state === "online" && restartCapable;
          if (update.state !== "online") syncedAt = 0;
          if (update.hostOffline) draft.hostOffline = true;
          else if (update.state !== "connecting") draft.hostOffline = false;
          const text = currentText();
          const reference = update.reference ?? null;
          if (update.state === "online") draft.connectionError = null;
          else if (update.message || reference) {
            const reconnecting = text.t("server.connection.reconnecting", { name: draft.host?.name ?? "" });
            draft.connectionError = {
              message:
                update.message && isSafeConnectionError(update.message)
                  ? text.errorMessage(update.message, reconnecting)
                  : reconnecting,
              reference,
            };
          }
          if (update.code)
            draft.connectionError = {
              message: text.t(
                update.code === "session_revoked"
                  ? "webClient.error.accessEnded"
                  : "server.compatibility.unsafeDataDescription",
              ),
              reference,
            };
          if (update.state !== "online") {
            draft.approvals = [];
            draft.contextStates = {};
            draft.backgroundWork = {};
            draft.threadContextStates = {};
            draft.prompts = [];
            draft.progress = {};
            draft.takeovers = [];
            draft.browserControlState = { sessions: [] };
            draft.duplicatingAgentIds = [];
          }
        });
        if (update.state === "offline") generation += 1;
        if (update.code) {
          hostLifecycle.endSleep();
          recoveryBlocked = true;
          recovery.suspend();
        }
        if (update.code === "session_revoked") {
          clearRevokedWorkspace();
          const revokedHostId = hostId;
          const revokedGeneration = generation;
          const revokedConnection = connectionPromise?.promise;
          void props
            .onSessionCheck()
            .then(() => refreshHosts())
            .then(async () => {
              await revokedConnection?.catch(() => undefined);
              const host = state.hosts.find((listed) => listed.hostId === revokedHostId);
              if (disposed || revokedReconnect || hostId !== revokedHostId || generation !== revokedGeneration || !host)
                return;
              revokedReconnect = true;
              return connect({ ...host });
            })
            .catch(report);
          return;
        }
        if (unavailable) {
          const current = generation;
          void hostLifecycle.hostUnavailable(update.hostId, connectionPromise?.opened ?? false).then((retry) => {
            if (retry && !update.hostOffline && !disposed && current === generation) recover();
          });
        } else if (state.hostRestart && update.state === "offline") recover();
        if (update.state === "online" && update.resync && !connectionPromise) recover();
      },
      event(id, event) {
        if (disposed || id !== hostId) return;
        for (const listener of hostEventListeners) listener(event);
        if (event.type === "team-presence")
          setState((draft) => {
            draft.presence = presenceWithChatColors(event.snapshot, draft.chatColors.members);
          });
        if (event.type === "host-restart")
          setState((draft) => {
            draft.hostRestart = event.state === "none" ? null : { state: event.state, version: event.version };
          });
        if (event.type === "host-appearance") setHostAppearance(id, event.appearance);
        if (event.type === "status") applyHostStatus(event.status);
        if (event.type === "runtime-snapshot") {
          const { attentionComplete } = event.snapshot;
          setState((draft) => {
            draft.approvals = reconcilePendingRequests(
              draft.approvals,
              keepWholeApprovals(draft.approvals, event.snapshot.pendingApprovals),
              attentionComplete,
            );
            draft.prompts = reconcilePendingRequests(
              draft.prompts,
              event.snapshot.pendingPrompts.map((prompt) => ({ ...prompt, type: "prompt" as const })),
              attentionComplete,
            );
            if (attentionComplete) listedPrompts = { generation, prompts: [] };
            else draft.prompts = withListedPrompts(draft.prompts);
            draft.takeovers = reconcilePendingRequests(
              draft.takeovers,
              event.snapshot.pendingBrowserTakeovers,
              attentionComplete,
            );
            draft.contextStates = Object.fromEntries(
              (event.snapshot.contextStates ?? []).map((context) => [context.agentId, context]),
            );
            draft.threadContextStates = Object.fromEntries(
              (event.snapshot.threadContextStates ?? []).map((context) => [context.threadId, context]),
            );
            draft.backgroundWork = Object.fromEntries(
              (event.snapshot.backgroundWork ?? []).map((work) => [
                backgroundWorkKey(work.agentId, work.taskId),
                work.since,
              ]),
            );
          });
          readWholeApprovals();
          if (!attentionComplete) readListedPrompts();
        } else if (event.type === "prompt") {
          setState((draft) => {
            draft.prompts = [...draft.prompts.filter((item) => item.requestId !== event.requestId), event];
          });
        } else if (event.type === "approval") {
          setState((draft) => {
            draft.approvals = [
              ...draft.approvals.filter((item) => item.requestId !== event.approval.requestId),
              event.approval,
            ];
          });
        } else if (event.type === "agent-input-resolved") {
          forgetListedPrompt(event.requestId);
          setState((draft) => {
            draft.approvals = draft.approvals.filter((item) => String(item.requestId) !== String(event.requestId));
            draft.prompts = draft.prompts.filter((item) => String(item.requestId) !== String(event.requestId));
          });
        } else if (event.type === "turn-progress") {
          setState((draft) => {
            draft.progress[event.agentId] = {
              turnId: event.turnId,
              detail: cleanAgentMessageText(event.detail),
              ...(event.running ? { running: true } : {}),
              ...(event.activity ? { activity: event.activity } : {}),
            };
          });
          setStepLines((current) =>
            appendTurnStepLine(current, event.turnId, cleanAgentMessageText(event.detail), event.error),
          );
        } else if (event.type === "turn-started") {
          setState((draft) => {
            delete draft.progress[event.agentId];
          });
        } else if (event.type === "conversation-delta") {
          applyDelta(event);
        } else if (event.type === "turn-completed") {
          setState((draft) => {
            if (draft.progress[event.agentId]?.turnId === event.turnId) delete draft.progress[event.agentId];
            draft.approvals = draft.approvals.filter(
              (item) =>
                item.agentId !== event.agentId || item.threadId !== event.threadId || item.turnId !== event.turnId,
            );
          });
        }
        if (event.type === "browser-takeover-requested")
          setState((draft) => {
            draft.takeovers = [
              ...draft.takeovers.filter((item) => item.requestId !== event.request.requestId),
              event.request,
            ];
          });
        if (event.type === "browser-takeover-resolved")
          setState((draft) => {
            draft.takeovers = draft.takeovers.filter((item) => String(item.requestId) !== String(event.requestId));
          });
        if (event.type === "browser-changed")
          setState((draft) => {
            const previous = new Map(draft.browserTabs.map((tab) => [tab.id, tab]));
            draft.browserTabs = event.tabs.map((tab) => {
              const kept = previous.get(tab.id);
              return {
                ...tab,
                ...(kept?.userControl ? { userControl: true as const } : {}),
                ...(kept?.canGoBack === undefined ? {} : { canGoBack: kept.canGoBack }),
                ...(kept?.canGoForward === undefined ? {} : { canGoForward: kept.canGoForward }),
                ...(kept?.httpSignIn === undefined ? {} : { httpSignIn: kept.httpSignIn }),
              };
            });
            draft.activeBrowserTabId = event.activeTabId;
          });
        if (event.type === "browser-page-state-changed")
          setState((draft) => {
            const states = new Map(event.tabs.map(({ tabId, ...state }) => [tabId, state]));
            draft.browserTabs = draft.browserTabs.map(({ canGoBack: _back, canGoForward: _forward, ...tab }) => ({
              ...tab,
              ...states.get(tab.id),
            }));
          });
        if (event.type === "browser-http-sign-in-changed")
          setState((draft) => {
            const prompts = new Map(event.tabs.map((prompt) => [prompt.tabId, prompt]));
            draft.browserTabs = draft.browserTabs.map(({ httpSignIn: _signIn, ...tab }) => {
              const prompt = prompts.get(tab.id);
              return prompt
                ? {
                    ...tab,
                    httpSignIn: { origin: prompt.origin, ...(prompt.refused ? { refused: true as const } : {}) },
                  }
                : tab;
            });
          });
        if (event.type === "browser-user-control-changed")
          setState((draft) => {
            const held = new Set(event.tabIds);
            draft.browserTabs = draft.browserTabs.map(({ userControl: _, ...tab }) =>
              held.has(tab.id) ? { ...tab, userControl: true } : tab,
            );
          });
        if (event.type === "browser-control-changed")
          setState((draft) => {
            draft.browserControlState = event.state;
          });
        if (event.type === "agents-changed") {
          reconcileAgents(event.agents);
          loadQueues(event.agents.flatMap((agent) => (state.queues[agent.id] ? [] : [agent.id])));
        }
        if (event.type === "queue-changed") {
          const { snapshot } = event;
          queueRevisions.set(snapshot.agentId, (queueRevisions.get(snapshot.agentId) ?? 0) + 1);
          partialQueues.delete(snapshot.agentId);
          setState((draft) => {
            draft.queues[snapshot.agentId] = snapshot;
          });
        }
        if (event.type === "queue-invalidated" && state.agents.some((agent) => agent.id === event.agentId))
          loadQueues([event.agentId]);
        if (event.type === "sidebar-layout-changed")
          setState((draft) => {
            if (event.layout.revision >= draft.sidebarLayout.revision) draft.sidebarLayout = event.layout;
          });
        if (event.type === "hidden-agents-changed")
          setState((draft) => {
            draft.userHiddenAgents = event.agents;
          });
        if (event.type === "agent-colors-changed")
          setState((draft) => {
            draft.agentColors = event.agents;
          });
        if (event.type === "chat-colors-changed") receiveChatColors({ agents: event.agents, members: event.members });
        if (event.type === "sidebar-pins-changed")
          preferences.receiveServerPins(pinScope(), { items: event.items, updatedAt: event.updatedAt });
        if (event.type === "conversation" || event.type === "conversation-invalidated") loadReadsSoon();
        const changed = changedConversation(event);
        if (changed !== undefined && changed === selectedId) void refresh();
      },
    },
    props.accountFetch,
  );
  const pinScope = () => (state.host ? `${props.accountId}:${state.host.hostId}` : "");
  const pinScopes = new Set<string>();
  const openHostPins = (scope: string) => {
    const pins = runtime.sidebarPins;
    if (!pins || scope !== pinScope()) throw new Error(currentText().t("error.team.sidebarPinsUnsupported"));
    return pins;
  };
  const preferences = createSidebarPreferences({
    scope: pinScope,
    sync: {
      supports: (scope) => pinScopes.has(scope),
      read: async (scope) => openHostPins(scope).read(),
      set: async (scope, items) => openHostPins(scope).set(items),
      seed: async (scope, items) => openHostPins(scope).seed(items),
    },
  });
  createEffect(
    () => ({ id: state.host?.hostId, status: state.status }),
    ({ id, status }) => {
      if (id) runtime.hosts?.reportSelected(id, status);
    },
  );
  createEffect(
    () =>
      state.status === "online" && state.host && !state.panelsLoading && !state.panelsFailed
        ? { hostId: state.host.hostId, sidebarLayout: state.sidebarLayout, hiddenAgents: state.userHiddenAgents }
        : null,
    (frame) => {
      if (frame)
        saveRemoteWorkspaceFrame(props.accountId, frame.hostId, {
          sidebarLayout: frame.sidebarLayout,
          hiddenAgents: frame.hiddenAgents,
        });
    },
  );
  createEffect(
    () =>
      state.status === "online" && state.host && !state.panelsLoading && !state.panelsFailed
        ? {
            hostId: state.host.hostId,
            unreadCounts: Object.fromEntries(
              Object.entries(state.reads).flatMap(([agentId, read]) =>
                read.unreadCount > 0 ? [[agentId, read.unreadCount]] : [],
              ),
            ),
          }
        : null,
    (frame) => {
      if (frame) saveRemoteFrameUnreadCounts(props.accountId, frame.hostId, frame.unreadCounts);
    },
  );
  const [duplicatingSectionIds, setDuplicatingSectionIds] = createSignal<ReadonlySet<string>>(new Set());
  const [pageFocused, setPageFocused] = createSignal(!document.hidden && document.hasFocus());
  const focusUse = createFocusUsePing(() => void runtime.focusUse().catch(() => undefined));
  createEffect(
    () =>
      pageFocused() && state.status === "online" && state.capabilities.includes(FOCUS_USE_CAPABILITY)
        ? (state.host?.hostId ?? null)
        : null,
    (id) => focusUse.setTarget(id),
  );
  const [serverOrder, setServerOrder] = createSignal(readWebServerOrder(props.accountId));
  const orderedHosts = createMemo(() => orderWebHosts(state.hosts, serverOrder()));
  const [avatars, setAvatars] = createSignal<ReadonlyMap<string, { source: string; url: string }>>(new Map());
  const avatarLoads = new Set<string>();
  const avatarMisses = new Set<string>();
  const avatarQueue: { hostId: string; id: string; source: string }[] = [];
  let avatarReads = 0;
  let avatarHost: string | null = null;
  let avatarOnline = false;
  let avatarAgents = "";
  async function loadAvatar(hostId: string, id: string, source: string): Promise<string | null> {
    const saved = await readSavedAgentPicture(props.accountId, hostId, id, source);
    if (saved || !avatarOnline || avatarHost !== hostId) return saved;
    const mark = agentPictureMark(props.accountId, hostId);
    const url = await runtime.agentAvatar(id, source);
    if (avatarHost === hostId) void saveAgentPicture(props.accountId, hostId, id, source, url, mark);
    return url;
  }
  function loadAvatars() {
    while (avatarReads < 2) {
      const next = avatarQueue.shift();
      if (!next) return;
      const { hostId, id, source } = next;
      const key = `${id} ${source}`;
      avatarReads += 1;
      void loadAvatar(hostId, id, source)
        .then(
          (url) => {
            if (avatarHost !== hostId) return;
            if (url) setAvatars((current) => new Map(current).set(id, { source, url }));
            else if (avatarOnline) avatarQueue.push(next);
            else {
              avatarLoads.delete(key);
              avatarMisses.add(key);
            }
          },
          () => {
            if (avatarHost === hostId) avatarLoads.delete(key);
          },
        )
        .finally(() => {
          avatarReads -= 1;
          loadAvatars();
        });
    }
  }
  createEffect(
    () => ({
      hostId: state.host?.hostId ?? null,
      online: state.status === "online",
      listed: state.status === "online" && !state.agentsFromFrame && state.agents.length > 0,
      sources: state.agents.flatMap((agent) =>
        agent.avatarUrl?.startsWith("openbot-avatar:") ? [{ id: agent.id, source: agent.avatarUrl }] : [],
      ),
    }),
    ({ hostId, online, listed, sources }) => {
      if (hostId !== avatarHost) {
        avatarHost = hostId;
        avatarAgents = "";
        avatarLoads.clear();
        avatarMisses.clear();
        avatarQueue.length = 0;
        setAvatars(new Map());
      }
      avatarOnline = online;
      if (!hostId) return;
      for (const { id, source } of sources) {
        const key = `${id} ${source}`;
        if (avatarLoads.has(key) || (!online && avatarMisses.has(key))) continue;
        avatarLoads.add(key);
        avatarQueue.push({ hostId, id, source });
      }
      loadAvatars();
      const agents = sources.map(({ id }) => id).join(" ");
      if (!listed || agents === avatarAgents) return;
      avatarAgents = agents;
      void keepSavedAgentPictures(
        props.accountId,
        hostId,
        sources.map(({ id }) => id),
      );
    },
  );
  const shownAgents = createMemo(() => {
    const colors = new Map(state.agentColors.map((entry) => [entry.agentId, entry.color]));
    const chatColors = new Map(state.chatColors.agents.map((entry) => [entry.agentId, entry.color]));
    return state.agents.map((agent) => {
      const avatar = avatars().get(agent.id);
      const {
        avatarColor: _avatarColor,
        chatColor: _chatColor,
        ...shown
      } = avatar && avatar.source === agent.avatarUrl ? { ...agent, avatarUrl: avatar.url } : agent;
      const color = colors.get(agent.id);
      const chatColor = chatColors.get(agent.id);
      return {
        ...shown,
        ...(color ? { avatarColor: color } : {}),
        ...(chatColor ? { chatColor } : {}),
      };
    });
  });
  const profiles = createMemo(() =>
    shownAgents().map((agent) => {
      const profile = toAgentProfile(agent);
      return state.agentsFromFrame ? { ...profile, preview: "" } : profile;
    }),
  );
  const selected = createMemo(() => profiles().find((agent) => agent.id === state.selectedId));
  const conversation = createMemo(() => (state.selectedId ? state.conversations[state.selectedId] : undefined));

  function report(error: unknown) {
    if (!disposed)
      setState((draft) => {
        draft.error = currentText().errorDetails(error, currentText().t("webClient.error.requestFailed"));
      });
  }
  async function run(action: () => Promise<void>) {
    if (running) return;
    running = true;
    const current = generation;
    setState((draft) => {
      draft.busy = true;
      draft.error = null;
    });
    try {
      await action();
    } catch (error) {
      if (current === generation) report(error);
    } finally {
      running = false;
      if (!disposed)
        setState((draft) => {
          draft.busy = false;
        });
    }
  }
  async function readSidebarLayout(
    capabilities: readonly string[],
    agentIds: readonly string[] = [],
  ): Promise<SidebarLayoutSnapshot> {
    const read = runtime.getSidebarLayout;
    if (!capabilities.includes("sidebar-layout") || !read)
      return { ...defaultSidebarLayout(), agentOrder: [...agentIds] };
    return read();
  }
  async function readUserHiddenAgents(capabilities: readonly string[]): Promise<HiddenAgent[]> {
    const read = runtime.listHiddenAgents;
    if (!capabilities.includes(AGENT_HIDDEN_CAPABILITY) || !read) return [];
    return (await read()).agents;
  }
  async function readAgentColors(capabilities: readonly string[]): Promise<AgentColorEntry[]> {
    const read = runtime.listAgentColors;
    if (!capabilities.includes(AGENT_COLORS_CAPABILITY) || !read) return [];
    return (await read()).agents;
  }
  async function readChatColors(capabilities: readonly string[]): Promise<ChatColors> {
    const read = runtime.listChatColors;
    if (!capabilities.includes(CHAT_COLORS_CAPABILITY) || !read) return { agents: [], members: [] };
    return read();
  }
  function receiveChatColors(colors: ChatColors): void {
    setState((draft) => {
      draft.chatColors = colors;
      if (draft.presence) draft.presence = presenceWithChatColors(draft.presence, colors.members);
    });
  }
  function reconcileAgents(agents: ClientAgentSummary[]): void {
    const ids = new Set(agents.map((agent) => agent.id));
    const nextSelected = selectedId && ids.has(selectedId) ? selectedId : null;
    selectedId = nextSelected;
    setState((draft) => {
      const removed = draft.agents.filter((agent) => !ids.has(agent.id)).map((agent) => agent.id);
      draft.agents = agents;
      draft.agentsLoaded = true;
      draft.agentsFromFrame = false;
      draft.hiddenIds = draft.hiddenIds.filter((id) => ids.has(id));
      draft.duplicatingAgentIds = draft.duplicatingAgentIds.filter((id) => ids.has(id));
      for (const id of removed) {
        delete draft.conversations[id];
        delete draft.queues[id];
        delete draft.progress[id];
      }
      if (nextSelected === null) draft.selectedId = null;
      const gone = new Set(removed);
      draft.sidebarLayout = {
        ...draft.sidebarLayout,
        agentOrder: draft.sidebarLayout.agentOrder.filter((id) => !gone.has(id)),
        agentAssignments: Object.fromEntries(
          Object.entries(draft.sidebarLayout.agentAssignments).filter(([id]) => !gone.has(id)),
        ),
      };
    });
  }
  function setHostAppearance(id: string, appearance: ServerAppearance | null): void {
    setState((draft) => {
      if (draft.host?.hostId === id) draft.host.appearance = appearance;
      const listed = draft.hosts.find((host) => host.hostId === id);
      if (listed) listed.appearance = appearance;
    });
  }
  function refreshHosts(): Promise<void> {
    if (hostsRefreshPromise) return hostsRefreshPromise;
    const promise = (async () => {
      if (disposed) return;
      setState((draft) => {
        draft.hostsLoading = true;
        draft.hostsError = null;
      });
      try {
        markRemoteSync("hosts-start");
        const cachedHostId = readWebServerSelection(props.accountId);
        const cachedHost =
          hostId === null
            ? (state.hosts.find((host) => host.hostId === cachedHostId) ??
              orderWebHosts(state.hosts, serverOrder())[0] ??
              null)
            : null;
        const listedHosts = runtime.listHosts();
        if (cachedHost) void connect(cachedHost);
        const refreshGeneration = generation;
        const refreshHostId = hostId;
        const hosts = await listedHosts;
        markRemoteSync("hosts");
        if (disposed) return;
        writeCachedWebHosts(props.accountId, hosts);
        deleteRemoteWorkspaceFrames(
          props.accountId,
          hosts.map((host) => host.hostId),
        );
        void deleteSavedAgentPictures(
          props.accountId,
          hosts.map((host) => host.hostId),
        );
        keepCachedWorkflows(
          props.accountId,
          hosts.map((host) => host.hostId),
        );
        const earlyHostId = cachedHost?.hostId ?? null;
        const activeGeneration =
          refreshHostId === hostId && (refreshGeneration === generation || refreshHostId === earlyHostId);
        if (!activeGeneration) {
          setState((draft) => {
            draft.hosts = hosts;
            draft.hostsLoaded = true;
          });
          return;
        }
        if (refreshHostId && !hosts.some((host) => host.hostId === refreshHostId)) {
          generation += 1;
          hostId = null;
          recovery.dispose();
          recovery = makeRecovery();
          hostLifecycle.endSleep();
          selectedId = null;
          setState((draft) => {
            draft.host = null;
            draft.workspaceLoaded = false;
            draft.synced = false;
            draft.memberId = null;
            draft.selectedId = null;
            draft.agents = [];
            draft.agentsLoaded = false;
            draft.conversations = {};
            draft.queues = {};
            draft.approvals = [];
            draft.contextStates = {};
            draft.backgroundWork = {};
            draft.threadContextStates = {};
            draft.prompts = [];
            draft.progress = {};
            setStepLines({});
            draft.takeovers = [];
            draft.browserTabs = [];
            draft.noticedBrowserTabIds = null;
            draft.activeBrowserTabId = null;
            draft.browserControlState = { sessions: [] };
            draft.sidebarLayout = defaultSidebarLayout();
            draft.userHiddenAgents = [];
            draft.agentColors = [];
            draft.reads = {};
            draft.chatColors = { agents: [], members: [] };
            draft.duplicatingAgentIds = [];
            draft.capabilities = [];
            draft.status = "offline";
            draft.error =
              leftHostIds.has(refreshHostId) || refreshHostId === earlyHostId
                ? null
                : { message: currentText().t("webClient.error.accessEnded"), reference: null };
          });
          runtime.hosts?.setHosts(hosts);
          await runtime.disconnect().catch(() => undefined);
        }
        const connected = hosts.find((host) => host.hostId === hostId);
        const listedEarlyHost = connected && connected.hostId === earlyHostId ? connected : null;
        setState((draft) => {
          if (listedEarlyHost && draft.host?.hostId === listedEarlyHost.hostId) {
            const appearance = draft.capabilities.includes(HOST_APPEARANCE_CAPABILITY)
              ? draft.host.appearance
              : listedEarlyHost.appearance;
            draft.host = { ...listedEarlyHost };
            if (appearance !== undefined) draft.host.appearance = appearance;
          } else if (connected && draft.host?.hostId === connected.hostId) {
            draft.host.name = connected.name;
            draft.host.logoKey = connected.logoKey;
            if (connected.appearance !== undefined && !draft.capabilities.includes(HOST_APPEARANCE_CAPABILITY))
              draft.host.appearance = connected.appearance;
          }
          draft.hosts = hosts;
          draft.hostsLoaded = true;
          draft.hostsError = null;
        });
        for (const left of leftHostIds) if (!hosts.some((host) => host.hostId === left)) leftHostIds.delete(left);
        if (listedEarlyHost && cachedHost && listedEarlyHost.devicePublicKey !== cachedHost.devicePublicKey) {
          await connectionPromise?.promise.catch(() => undefined);
          if (!disposed && hostId === listedEarlyHost.hostId) await connect(listedEarlyHost);
        }
        if (!hostId) {
          const savedHostId = readWebServerSelection(props.accountId);
          const ordered = orderWebHosts(hosts, serverOrder());
          const initialHost =
            hosts.find((host) => host.hostId === savedHostId && host.hidden !== true) ??
            ordered.find((host) => host.hidden !== true) ??
            ordered[0];
          if (initialHost) await connect(initialHost);
        }
        if (!disposed) runtime.hosts?.setHosts(hosts);
      } catch (error) {
        if (!disposed) {
          const failure = currentText().errorDetails(error, currentText().t("webClient.error.hostsFailed"));
          setState((draft) => {
            draft.hostsError = failure;
          });
        }
        throw error;
      } finally {
        if (!disposed)
          setState((draft) => {
            draft.hostsLoading = false;
          });
      }
    })();
    hostsRefreshPromise = promise;
    void promise.then(
      () => {
        if (hostsRefreshPromise === promise) hostsRefreshPromise = null;
      },
      () => {
        if (hostsRefreshPromise === promise) hostsRefreshPromise = null;
      },
    );
    return promise;
  }
  async function leaveHost(host: RemoteTeamHost): Promise<void> {
    await departHost(host, () => runtime.leaveHost(host.hostId, host.membershipId));
  }
  async function removeOwnedHost(host: RemoteTeamHost): Promise<void> {
    const remove = runtime.removeOwnedHost;
    if (!remove) throw new Error(currentText().t("server.settings.actionFailed"));
    await departHost(host, () => remove(host.hostId));
  }
  async function setHostHidden(host: RemoteTeamHost, hidden: boolean): Promise<void> {
    const change = runtime.setHostHidden;
    if (!change) throw new Error(currentText().t("server.settings.actionFailed"));
    await change(host.hostId, hidden);
    setState((draft) => {
      const listed = draft.hosts.find((candidate) => candidate.hostId === host.hostId);
      if (!listed) return;
      if (hidden) listed.hidden = true;
      else delete listed.hidden;
    });
    void (hostsRefreshPromise ?? Promise.resolve()).catch(() => undefined).then(retryHosts);
  }
  async function departHost(host: RemoteTeamHost, operation: () => Promise<void>): Promise<void> {
    leftHostIds.add(host.hostId);
    try {
      await operation();
    } catch (error) {
      leftHostIds.delete(host.hostId);
      throw error;
    }
    void (hostsRefreshPromise ?? Promise.resolve()).catch(() => undefined).then(retryHosts);
  }
  function retryHosts(): Promise<void> {
    return refreshHosts().catch(() => undefined);
  }
  function setHostedSleep(hostedSleep: HostedServerSleep | null): void {
    if (state.hostedSleep !== hostedSleep)
      setState((draft) => {
        draft.hostedSleep = hostedSleep;
      });
  }
  function clearRevokedWorkspace(): void {
    if (hostId) {
      deleteRemoteWorkspaceFrame(props.accountId, hostId);
      void deleteSavedServerPictures(props.accountId, hostId);
      deleteCachedWorkflows(hostId);
    }
    generation += 1;
    restartCapable = false;
    selectedId = null;
    setState((draft) => {
      draft.revocationRevision += 1;
      draft.restartReady = false;
      draft.workspaceLoaded = false;
      draft.synced = false;
      draft.agents = [];
      draft.agentsLoaded = false;
      draft.conversations = {};
      draft.queues = {};
      draft.selectedId = null;
      draft.approvals = [];
      draft.contextStates = {};
      draft.backgroundWork = {};
      draft.threadContextStates = {};
      draft.prompts = [];
      draft.progress = {};
      setStepLines({});
      draft.takeovers = [];
      draft.browserTabs = [];
      draft.noticedBrowserTabIds = null;
      draft.activeBrowserTabId = null;
      draft.browserControlState = { sessions: [] };
      draft.sidebarLayout = defaultSidebarLayout();
      draft.userHiddenAgents = [];
      draft.agentColors = [];
      draft.reads = {};
      draft.chatColors = { agents: [], members: [] };
      draft.capabilities = [];
      draft.presence = null;
      draft.duplicatingAgentIds = [];
    });
  }
  function blockAccess(error: unknown): boolean {
    if (
      !(error instanceof WebHostConnectionError) ||
      (error.code !== "authentication_required" && error.code !== "access_ended")
    )
      return false;
    clearRevokedWorkspace();
    hostLifecycle.endSleep();
    recoveryBlocked = true;
    recovery.suspend();
    const failure = { message: error.message, reference: errorReference(error) };
    setState((draft) => {
      draft.status = "offline";
      draft.connectionError = failure;
    });
    return true;
  }
  async function reconnect(): Promise<void> {
    const host = state.hosts.find((listed) => listed.hostId === hostId) ?? state.host;
    if (!host || connectionPromise) return;
    if (state.hostedSleep === "sleeping" || state.hostedIssue) await hostLifecycle.retry();
    else {
      await props.onSessionCheck();
      recoveryBlocked = false;
      await connect(host);
    }
  }
  async function joinInvite(inviteUrl: string): Promise<void> {
    const normalizedInviteUrl = inviteUrl.trim();
    if (!normalizedInviteUrl) throw new Error(currentText().t("webClient.error.enterInvitation"));
    const cached = acceptedInvite?.inviteUrl === normalizedInviteUrl ? acceptedInvite : null;
    const host = cached?.host ?? (await runtime.acceptInvite(normalizedInviteUrl));
    acceptedInvite = { inviteUrl: normalizedInviteUrl, host };
    const hadHostSelection = hostId !== null;
    await refreshHosts();
    if (state.host?.hostId !== host.hostId || (state.status !== "online" && hadHostSelection)) await connect(host);
    if (state.status !== "online" || state.host?.hostId !== host.hostId)
      throw new Error(currentText().t("webClient.error.invitationOffline"));
    acceptedInvite = null;
  }
  async function connect(host: RemoteTeamHost, takeOver = false) {
    recoveryBlocked = false;
    recovery.dispose();
    recovery = makeRecovery();
    if (!connectionPromise || connectionPromise.hostId !== host.hostId) hostLifecycle.endSleep();
    try {
      await attemptConnection(host, true, takeOver);
    } catch (error) {
      if (!disposed && hostId === host.hostId) noteConnectionFailure(error);
      if (!disposed && hostId === host.hostId && state.recovery?.phase !== "suspended") recover();
    }
  }
  function restartRequested(): void {
    if (state.status !== "online") generation += 1;
  }
  async function useHere(): Promise<void> {
    const host = state.host;
    if (host && state.otherTab) await connect(host, true);
  }
  function attemptConnection(host: RemoteTeamHost, opened = false, takeOver = false): Promise<void> {
    if (connectionPromise?.hostId === host.hostId) return connectionPromise.promise;
    const promise = connectWorkspace(host, opened, takeOver).finally(() => {
      if (connectionPromise?.promise === promise) connectionPromise = null;
    });
    connectionPromise = { hostId: host.hostId, opened, promise };
    return promise;
  }
  async function connectWorkspace(host: RemoteTeamHost, opened: boolean, takeOver: boolean) {
    const current = ++generation;
    const sameHost = hostId === host.hostId;
    const keepWorkspace = sameHost && state.workspaceLoaded;
    const savedFrame = keepWorkspace ? null : readRemoteWorkspaceFrame(props.accountId, host.hostId);
    const frame = savedFrame?.agents.length ? savedFrame : null;
    const frameSelected = frame?.agents.find((agent) => agent.id === frame.selectedAgentId) ?? frame?.agents[0];
    const previousSelected = (sameHost ? selectedId : null) ?? frameSelected?.id ?? null;
    const recentAgentIds = frame?.recentAgentIds ?? [];
    hostId = host.hostId;
    writeWebServerSelection(props.accountId, host.hostId);
    if (!keepWorkspace) selectedId = null;
    if (!sameHost) hostLifecycle.endSleep();
    if (!sameHost) restartCapable = false;
    setState((draft) => {
      draft.host = host;
      draft.recovery = null;
      if (!sameHost) draft.connectionError = null;
      if (!sameHost) draft.hostOffline = false;
      if (!sameHost) draft.otherTab = false;
      if (!sameHost) {
        draft.workspaceLoaded = false;
        draft.synced = false;
        draft.agentStatus = null;
        draft.models = [];
      }
      draft.status = "connecting";
      draft.hostRestart = null;
      if (!sameHost) draft.restartReady = false;
      draft.memberId = sameHost ? draft.memberId : null;
      if (!keepWorkspace) {
        draft.agents = [];
        draft.agentsLoaded = false;
        draft.agentsFromFrame = false;
        draft.frameChannels = [];
        draft.selectedId = null;
      }
      if (!sameHost) {
        draft.conversations = {};
        draft.queues = {};
        draft.hiddenIds = [];
      }
      draft.approvals = [];
      draft.contextStates = {};
      draft.backgroundWork = {};
      draft.threadContextStates = {};
      draft.prompts = [];
      draft.takeovers = [];
      draft.browserControlState = { sessions: [] };
      if (!keepWorkspace) {
        draft.progress = {};
        draft.browserTabs = [];
        draft.noticedBrowserTabIds = null;
        draft.activeBrowserTabId = null;
        draft.sidebarLayout = defaultSidebarLayout();
        draft.userHiddenAgents = [];
        draft.agentColors = [];
        draft.reads = {};
        draft.chatColors = { agents: [], members: [] };
        draft.duplicatingAgentIds = [];
        draft.capabilities = [];
        draft.presence = null;
      }
      draft.error = null;
      draft.incompatibility = null;
    });
    try {
      markRemoteSync("connect-start");
      const early: { gate: Promise<[ClientAgentSummary[], AgentStatus, ClientAgentModelOption[]]> | null } = {
        gate: null,
      };
      const readGate = () => Promise.all([runtime.listAgents(), runtime.status(), runtime.models()]);
      const connecting = runtime.connect(host, {
        takeOver,
        early: {
          start: () => {
            early.gate = readGate();
            early.gate.catch(() => undefined);
          },
          drop: () => {
            early.gate = null;
          },
        },
      });
      if (frame) {
        if (frameSelected) selectedId = frameSelected.id;
        setState((draft) => {
          draft.agents = frame.agents;
          draft.agentsLoaded = true;
          draft.agentsFromFrame = true;
          draft.workspaceLoaded = true;
          draft.models = frame.models;
          draft.sidebarLayout = frame.sidebarLayout ?? {
            ...defaultSidebarLayout(),
            agentOrder: frame.agents.map((agent) => agent.id),
          };
          draft.userHiddenAgents = frame.hiddenAgents;
          draft.frameChannels = frame.channels;
          draft.reads = Object.fromEntries(
            Object.entries(frame.unreadCounts).map(([agentId, unreadCount]) => [
              agentId,
              { unreadCount, firstUnreadMessageId: null, throughMessageId: null },
            ]),
          );
          if (frameSelected) {
            draft.selectedId = frameSelected.id;
            draft.conversations[frameSelected.id] ??= { page: null, draft: "", attachments: [], loading: true };
          }
        });
        markRemoteSync("workspace-frame");
      }
      const capabilities = await connecting;
      markRemoteSync("connected");
      if (!disposed && current === generation) {
        restartCapable = capabilities.includes(HOST_RESTART_CAPABILITY);
        setState((draft) => {
          draft.restartReady = restartCapable;
        });
      }
      const [agents, agentStatus, models] = await (early.gate ?? readGate());
      if (disposed || current !== generation) return;
      revokedReconnect = false;
      hostLifecycle.endSleep();
      const unblocked = recoveryBlocked;
      if (unblocked) {
        recoveryBlocked = false;
        recovery.dispose();
        recovery = makeRecovery();
      }
      setState((draft) => {
        if (unblocked) draft.recovery = null;
        draft.capabilities = capabilities;
        draft.agents = agents;
        draft.agentsLoaded = true;
        draft.agentsFromFrame = false;
        draft.workspaceLoaded = true;
        draft.synced = true;
        draft.agentStatus = agentStatus;
        draft.models = models;
        draft.connectionError = null;
        draft.otherTab = false;
        draft.status = "online";
      });
      syncedAt = Date.now();
      markRemoteSync("workspace-ready");
      saveRemoteWorkspaceFrame(props.accountId, host.hostId, { agents, models });
      if (capabilities.includes(SIDEBAR_PINS_CAPABILITY)) pinScopes.add(pinScope());
      else pinScopes.delete(pinScope());
      preferences.reconcileActiveServerPins(agents.map((agent) => agent.id));
      void preferences.syncActiveServerPins().catch(() => undefined);
      const wanted = selectedId ?? previousSelected;
      const first = agents.find((agent) => agent.id === wanted) ?? agents[0];
      const opened = first ? select(first.id) : null;
      if (first) loadQueue(first.id);
      void loadPanels(
        capabilities,
        agents.map((agent) => agent.id),
      ).then(() => {
        if (!disposed && current === generation) saveFrame();
        markRemoteSync("panels-ready");
      });
      void runtime
        .currentMemberId?.()
        .then((memberId) => {
          if (!disposed && current === generation)
            setState((draft) => {
              draft.memberId = memberId;
            });
        })
        .catch(() => undefined);
      void runtime.admin?.team.getPresence().then(
        (presence) => {
          if (!disposed && current === generation && !state.presence)
            setState((draft) => {
              draft.presence = presenceWithChatColors(presence, draft.chatColors.members);
            });
        },
        () => undefined,
      );
      if (opened) {
        await opened;
        markRemoteSync("conversation-ready");
      }
      if (disposed || current !== generation) return;
      void preloadRecent(
        recentAgentIds.filter((id) => id !== first?.id && agents.some((agent) => agent.id === id)),
        current,
      );
      loadQueues(agents.flatMap((agent) => (agent.id === first?.id ? [] : [agent.id])));
    } catch (error) {
      if (disposed || current !== generation) return;
      setState((draft) => {
        draft.status = "offline";
        draft.otherTab = error instanceof WebHostOtherTabError;
        if (error instanceof WebHostIncompatibleError)
          draft.incompatibility = {
            hostId: host.hostId,
            code: error.code,
            message: error.message,
            hostAppVersion: error.hostAppVersion,
            hostProtocol: { ...error.hostProtocol },
          };
      });
      if (blockAccess(error)) throw error;
      if (error instanceof WebHostOtherTabError) {
        hostLifecycle.endSleep();
        recoveryBlocked = true;
        recovery.suspend();
        setState((draft) => {
          draft.connectionError = null;
        });
      } else if (error instanceof WebHostIncompatibleError || error instanceof WebHostConnectionError) {
        hostLifecycle.endSleep();
        recoveryBlocked = true;
        recovery.suspend();
        const failure = { message: error.message, reference: errorReference(error) };
        setState((draft) => {
          draft.connectionError = failure;
        });
      } else {
        const text = currentText();
        const failure = text.errorDetails(error, text.t("server.connection.reconnecting", { name: host.name }));
        setState((draft) => {
          draft.connectionError = failure;
        });
        await hostLifecycle.hostUnavailable(host.hostId, opened);
      }
      throw error;
    }
  }
  function saveFrame(): void {
    if (state.status !== "online" || !state.host) return;
    const panelsRead = !state.panelsLoading && !state.panelsFailed;
    saveRemoteWorkspaceFrame(props.accountId, state.host.hostId, {
      agents: state.agents,
      models: state.models,
      selectedAgentId: state.selectedId,
      ...(panelsRead ? { sidebarLayout: state.sidebarLayout, hiddenAgents: state.userHiddenAgents } : {}),
    });
  }
  async function loadPanels(capabilities = state.capabilities, agentIds = state.agents.map((agent) => agent.id)) {
    const current = generation;
    const isCurrent = () => !disposed && current === generation;
    setState((draft) => {
      draft.panelsFailed = false;
      draft.panelsLoading = true;
    });
    const failed = () => {
      if (isCurrent())
        setState((draft) => {
          draft.panelsFailed = true;
        });
    };
    await Promise.all([
      (capabilities.includes("browser-control") ? runtime.browserTabs() : Promise.resolve([]))
        .then((browserTabs) => {
          if (!isCurrent()) return;
          setState((draft) => {
            draft.browserTabs = browserTabs;
            draft.noticedBrowserTabIds ??= browserTabs.map((tab) => tab.id);
            draft.activeBrowserTabId = browserTabs.some((tab) => tab.id === draft.activeBrowserTabId)
              ? draft.activeBrowserTabId
              : (browserTabs[0]?.id ?? null);
          });
        })
        .catch(failed),
      readSidebarLayout(capabilities, agentIds)
        .then((layout) => {
          if (isCurrent())
            setState((draft) => {
              if (layout.revision >= draft.sidebarLayout.revision) draft.sidebarLayout = layout;
            });
        })
        .catch(failed),
      readUserHiddenAgents(capabilities)
        .then((agents) => {
          if (isCurrent())
            setState((draft) => {
              draft.userHiddenAgents = agents;
            });
        })
        .catch(failed),
      readAgentColors(capabilities)
        .then((colors) => {
          if (isCurrent())
            setState((draft) => {
              draft.agentColors = colors;
            });
        })
        .catch(() => undefined),
      readChatColors(capabilities)
        .then((colors) => {
          if (isCurrent()) receiveChatColors(colors);
        })
        .catch(() => undefined),
      readReads(),
    ]);
    if (isCurrent())
      setState((draft) => {
        draft.panelsLoading = false;
      });
  }

  async function load(id: string, older = false) {
    const current = generation;
    const previous = state.conversations[id];
    if (older && previous?.trimmed) {
      if (!conversationReads.has(id)) await load(id);
      return;
    }
    const before = older ? (previous?.page?.pageInfo.olderCursor ?? undefined) : undefined;
    if (older && !before) return;
    conversationReads.set(id, (conversationReads.get(id) ?? 0) + 1);
    try {
      const page = await runtime.conversation(id, before);
      if (disposed || current !== generation) return;
      if (page.agentId !== id) throw new Error(currentText().t("webClient.error.otherConversation"));
      setState((draft) => {
        const item = draft.conversations[id];
        if (!item) return;
        const old = item.page?.threadId === page.threadId ? item.page : null;
        if (old && page.revision < old.revision) return;
        if (older && (item.trimmed || old?.pageInfo.olderCursor !== before)) return;
        const merge = older ? "older" : old && !item.trimmed ? "latest" : "replace";
        const around = !older && merge === "latest" && item.around === true && page.pageInfo.hasOlder;
        const resolvedRequests = new Set(
          page.messages.flatMap((message) =>
            message.questionPrompt?.resolution ? [messagePromptRequestKey(message)] : [],
          ),
        );
        draft.prompts = draft.prompts.filter(
          (prompt) =>
            prompt.agentId !== id ||
            prompt.threadId !== page.threadId ||
            !resolvedRequests.has(promptRequestKey(prompt.turnId, prompt.requestId)),
        );
        const pageIds = new Set(page.messages.map((message) => message.id));
        const apart =
          merge === "latest" &&
          !around &&
          page.pageInfo.hasOlder &&
          !(old?.messages ?? []).some((message) => pageIds.has(message.id));
        item.page = {
          ...page,
          messages: around
            ? windowedSnapshotMessages(old?.messages ?? [], page.messages, { mode: "around", capped: true })
            : mergeConversationPage(old?.messages ?? [], page.messages, apart ? "replace" : merge),
          references: merge === "replace" ? page.references : { ...old?.references, ...page.references },
          pageInfo: merge === "latest" && !apart ? (old?.pageInfo ?? page.pageInfo) : page.pageInfo,
          revision: older && old ? old.revision : page.revision,
        };
        item.missingReferences = {
          ...(merge === "replace" ? {} : item.missingReferences),
          ...missingReplyOriginals(page),
        };
        if (!older && page.readState) draft.reads[id] = page.readState;
        if (!older && draft.selectedId === id) item.trimmed = false;
        if (!older && !around) item.around = false;
        item.loading = false;
        item.error = null;
        item.olderError = null;
      });
      if (!older)
        for (const messageId of openExchangesOutside(state.conversations[id]?.page?.messages ?? [], page.messages))
          refreshOpenExchange(id, messageId);
    } catch (error) {
      if (!disposed && current === generation && !blockAccess(error))
        setState((draft) => {
          const item = draft.conversations[id];
          if (!item) return;
          item.loading = false;
          if (older) item.olderError = currentText().errorMessage(error, currentText().t("chat.history.olderFailed"));
          else item.error = currentText().t("webClient.error.requestFailed");
        });
      throw error;
    } finally {
      const reads = (conversationReads.get(id) ?? 1) - 1;
      if (reads > 0) conversationReads.set(id, reads);
      else {
        conversationReads.delete(id);
        const held = heldDeltas.get(id) ?? [];
        heldDeltas.delete(id);
        for (const event of held) applyDelta(event);
      }
    }
  }
  function applyDelta(event: Extract<AgentEvent, { type: "conversation-delta" }>) {
    if (disposed || event.agentId !== selectedId) return;
    if (conversationReads.has(event.agentId)) {
      const held = heldDeltas.get(event.agentId);
      if (held) held.push(event);
      else heldDeltas.set(event.agentId, [event]);
      return;
    }
    let otherThread = false;
    setState((draft) => {
      const item = draft.conversations[event.agentId];
      const value = item?.page;
      if (!value) return;
      if (value.threadId !== event.threadId) {
        otherThread = true;
        return;
      }
      if (event.revision <= value.revision) return;
      const message = value.messages.findLast((entry) => entry.id === event.messageId);
      if (message) {
        message.text += event.delta;
        message.status = "streaming";
      } else if (item.around) return;
      else
        value.messages.push({
          id: event.messageId,
          turnId: event.turnId,
          author: "assistant",
          source: "assistant",
          text: event.delta,
          createdAt: event.createdAt,
          status: "streaming",
        });
      value.revision = event.revision;
      value.activeTurnId = event.turnId;
    });
    if (otherThread) void refresh();
  }
  function loadQueue(id: string): void {
    const running = queueLoads.get(id);
    if (running?.generation === generation) {
      running.again = true;
      return;
    }
    const load = { generation, again: true };
    queueLoads.set(id, load);
    void (async () => {
      try {
        while (load.again && !disposed && load.generation === generation) {
          load.again = false;
          const revision = queueRevisions.get(id) ?? 0;
          const queue = await runtime.queue(id);
          if (disposed || load.generation !== generation || (queueRevisions.get(id) ?? 0) !== revision) continue;
          partialQueues.delete(id);
          setState((draft) => {
            draft.queues[id] = queue;
          });
        }
      } catch (error) {
        if (load.generation === generation) report(error);
      } finally {
        if (queueLoads.get(id) === load) queueLoads.delete(id);
      }
    })();
  }
  function loadQueues(ids: readonly string[]): void {
    if (ids.length === 0) return;
    if (!state.capabilities.includes(AGENT_ACTIVE_QUEUES_CAPABILITY)) {
      for (const id of ids) loadQueue(id);
      return;
    }
    for (const id of ids) queueListPending.add(id);
    if (queueListRunning === generation) return;
    const current = generation;
    queueListRunning = current;
    void (async () => {
      try {
        while (queueListPending.size > 0 && !disposed && current === generation) {
          const pending = [...queueListPending];
          queueListPending.clear();
          const listed = pending.filter((id) => id !== selectedId).slice(0, AGENT_ACTIVE_QUEUES_LIMIT);
          const inList = new Set(listed);
          for (const id of pending) if (!inList.has(id)) loadQueue(id);
          if (listed.length === 0) continue;
          const revisions = new Map(listed.map((id) => [id, queueRevisions.get(id) ?? 0]));
          let answer: AgentActiveQueues;
          try {
            answer = await runtime.activeQueues(listed);
          } catch {
            if (!disposed && current === generation) for (const id of listed) loadQueue(id);
            continue;
          }
          if (disposed || current !== generation) return;
          const fresh = answer.queues.filter(
            (queue) =>
              queue.agentId !== selectedId &&
              revisions.has(queue.agentId) &&
              (queueRevisions.get(queue.agentId) ?? 0) === revisions.get(queue.agentId),
          );
          for (const queue of fresh) partialQueues.add(queue.agentId);
          if (fresh.length > 0)
            setState((draft) => {
              for (const queue of fresh) draft.queues[queue.agentId] = queue;
            });
          for (const id of answer.omitted) if (revisions.has(id)) loadQueue(id);
          if (selectedId && revisions.has(selectedId)) loadQueue(selectedId);
        }
      } finally {
        if (queueListRunning === current) queueListRunning = null;
      }
    })();
  }
  function changeQueue(change: (agentId: string) => Promise<void>) {
    const id = selectedId;
    const current = generation;
    if (!id || state.status !== "online") return;
    void change(id).catch((error) => {
      if (current === generation) report(error);
    });
  }
  async function select(id: string) {
    const current = generation;
    selectedId = id;
    if (partialQueues.has(id)) loadQueue(id);
    if (state.status === "online" && state.host)
      saveRemoteWorkspaceFrame(props.accountId, state.host.hostId, { selectedAgentId: id });
    setState((draft) => {
      const previous = draft.selectedId;
      if (previous && previous !== id) {
        const closed = draft.conversations[previous];
        if (closed) trimToLatestPage(closed);
      }
      draft.selectedId = id;
      draft.conversations[id] ??= {
        page: null,
        draft: "",
        attachments: [],
        loading: true,
      };
      draft.conversations[id].loading = true;
      draft.conversations[id].error = null;
    });
    try {
      await load(id);
    } catch (error) {
      if (disposed || current !== generation) return;
      report(error);
    }
  }
  async function preloadRecent(ids: readonly string[], current: number) {
    const pending = ids.slice(0, PRELOADED_AGENTS);
    let next = 0;
    const worker = async () => {
      while (next < pending.length) {
        if (disposed || current !== generation) return;
        const id = pending[next++];
        if (!id || state.conversations[id]) continue;
        setState((draft) => {
          draft.conversations[id] ??= { page: null, draft: "", attachments: [], loading: false, trimmed: true };
        });
        try {
          await load(id);
        } catch {}
      }
    };
    await Promise.all(Array.from({ length: Math.min(PRELOAD_CONCURRENCY, pending.length) }, worker));
  }
  let readsLoad: { generation: number; promise: Promise<void> } | null = null;
  let pendingReads = false;
  let readsStartedAt = 0;
  let readsTimer: ReturnType<typeof setTimeout> | null = null;
  function readReads(): Promise<void> {
    pendingReads = true;
    if (readsLoad?.generation === generation) return readsLoad.promise;
    const current = generation;
    const promise = (async () => {
      while (pendingReads && !disposed && current === generation) {
        pendingReads = false;
        readsStartedAt = Date.now();
        const value = await runtime.conversationReads().catch(() => null);
        if (!value || disposed || current !== generation) continue;
        setState((draft) => {
          draft.reads = value;
        });
      }
    })().finally(() => {
      if (readsLoad?.promise === promise) readsLoad = null;
    });
    readsLoad = { generation: current, promise };
    return promise;
  }
  function loadReads(): void {
    void readReads();
  }
  function loadReadsSoon(): void {
    if (readsTimer) return;
    const wait = readsStartedAt + EVENT_READS_INTERVAL_MS - Date.now();
    if (wait <= 0) {
      loadReads();
      return;
    }
    readsTimer = setTimeout(() => {
      readsTimer = null;
      loadReads();
    }, wait);
  }
  async function resync() {
    const current = generation;
    try {
      const [{ agents, sidebarLayout }, userHiddenAgents, agentColors, chatColors] = await Promise.all([
        runtime.listAgents().then(async (agents) => ({
          agents,
          sidebarLayout: await readSidebarLayout(
            state.capabilities,
            agents.map((agent) => agent.id),
          ),
        })),
        readUserHiddenAgents(state.capabilities),
        readAgentColors(state.capabilities).catch(() => state.agentColors),
        readChatColors(state.capabilities).catch(() => state.chatColors),
      ]);
      if (disposed || current !== generation) return;
      syncedAt = Date.now();
      reconcileAgents(agents);
      setState((draft) => {
        if (sidebarLayout.revision >= draft.sidebarLayout.revision) draft.sidebarLayout = sidebarLayout;
        draft.userHiddenAgents = userHiddenAgents;
        draft.agentColors = agentColors;
      });
      receiveChatColors(chatColors);
      loadQueues(agents.map((agent) => agent.id));
      loadReads();
      if (!selectedId && agents[0]) await select(agents[0].id);
      await refresh();
    } catch (error) {
      if (current === generation) report(error);
    }
  }
  const openExchangeReads = new Map<string, { again: boolean }>();
  function refreshOpenExchange(id: string, messageId: string) {
    const readAround = runtime.conversationAround;
    if (!readAround || !state.capabilities.includes("conversation-pagination")) return;
    const key = `${id}\0${messageId}`;
    const running = openExchangeReads.get(key);
    if (running) {
      running.again = true;
      return;
    }
    const read = { again: true };
    openExchangeReads.set(key, read);
    const current = generation;
    void (async () => {
      try {
        while (read.again && !disposed && current === generation) {
          read.again = false;
          const page = await readAround(id, messageId, 1);
          const message = page.messages.find((candidate) => candidate.id === messageId);
          if (disposed || current !== generation || !message) return;
          setState((draft) => {
            const loaded = draft.conversations[id]?.page;
            if (!loaded || loaded.threadId !== page.threadId || page.revision < loaded.revision) return;
            const index = loaded.messages.findIndex((candidate) => candidate.id === messageId);
            if (index >= 0) loaded.messages[index] = message;
          });
        }
      } finally {
        openExchangeReads.delete(key);
      }
    })().catch(() => undefined);
  }
  async function refresh() {
    pendingReload = true;
    if (reloadPromise) return reloadPromise;
    reloadPromise = (async () => {
      while (pendingReload && !disposed) {
        pendingReload = false;
        const id = selectedId;
        if (id) {
          const current = generation;
          try {
            await load(id);
          } catch (error) {
            if (current === generation) report(error);
          }
        }
      }
    })();
    try {
      await reloadPromise;
    } finally {
      reloadPromise = null;
    }
  }
  async function send(
    id: string,
    text: string,
    attachmentDraftIds: string[],
    replyToMessageId: string | null = null,
    clientMessageId?: string,
  ): Promise<{ messageId: string } | { error: string }> {
    const { t, errorMessage } = currentText();
    if (state.status !== "online") return { error: t("chat.errorStatus.send") };
    if (text.length > INPUT_LIMITS.messageText) return { error: t("webClient.error.messageTooLong") };
    const current = generation;
    let messageId: string;
    try {
      messageId = await runtime.send(id, text, attachmentDraftIds, replyToMessageId, clientMessageId);
    } catch (error) {
      return { error: errorMessage(error, t("webClient.error.deliveryUnconfirmed")) };
    }
    if (current === generation && !disposed)
      refresh().catch((error: unknown) => {
        if (current === generation) report(error);
      });
    return { messageId };
  }
  function markRead() {
    const id = selectedId;
    if (!id || state.status !== "online") return Promise.resolve();
    const current = generation;
    const write = (readWrites.get(id) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        const conversation = state.conversations[id];
        const page = conversation?.page;
        if (!page || conversation.around || disposed || current !== generation) return;
        const readState = await runtime.markRead(id, page.messages.at(-1)?.id ?? null);
        if (disposed || current !== generation) return;
        setState((draft) => {
          const value = draft.conversations[id]?.page;
          if (value?.threadId === page.threadId) value.readState = readState;
          draft.reads[id] = readState;
        });
      });
    readWrites.set(id, write);
    return write;
  }
  function markAgentRead(id: string) {
    const current = generation;
    const write = (readWrites.get(id) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        if (disposed || current !== generation) return;
        const page = await runtime.conversation(id);
        const latestMessageId = page.messages.at(-1)?.id;
        if (!latestMessageId || disposed || current !== generation) return;
        const readState = await runtime.markRead(id, latestMessageId);
        if (disposed || current !== generation) return;
        setState((draft) => {
          const value = draft.conversations[id]?.page;
          if (value?.threadId === page.threadId) value.readState = readState;
          draft.reads[id] = readState;
        });
      });
    readWrites.set(id, write);
    return write;
  }
  async function markAllRead() {
    if (state.status !== "online") return;
    const current = generation;
    const reads = await runtime.conversationReads();
    if (disposed || current !== generation) return;
    await Promise.all(
      Object.entries(reads)
        .filter(([, read]) => read.unreadCount > 0)
        .map(([id]) => markAgentRead(id)),
    );
  }
  async function markUnreadFrom(agentId: string, messageId: string): Promise<void> {
    const current = generation;
    const write = (readWrites.get(agentId) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        const readState = await runtime.markUnreadFrom(agentId, messageId);
        if (disposed || current !== generation) return;
        setState((draft) => {
          const value = draft.conversations[agentId]?.page;
          if (value) value.readState = readState;
          draft.reads[agentId] = readState;
        });
      });
    readWrites.set(agentId, write);
    await write;
  }
  async function markLatestReplyUnread(agentId: string): Promise<void> {
    const reply = latestIncomingConversationMessage((await runtime.conversation(agentId)).messages);
    if (reply) await markUnreadFrom(agentId, reply.id);
  }
  const hostViews = (): HostRestartView[] =>
    state.host
      ? [
          {
            id: state.host.hostId,
            name: state.host.name,
            online: state.status === "online",
            restart: state.hostRestart?.state ?? null,
            version: state.hostRestart?.version ?? null,
            firstRun: !state.agentsLoaded || state.agents.length === 0,
          },
        ]
      : [];
  createHostRestartToasts(() => hostViews().filter((host) => !followsServerUpdate(host.id)));
  onSettled(() => {
    void refreshHosts().catch(report);
    const pageFocus = () => setPageFocused(!document.hidden && document.hasFocus());
    const focus = () => {
      pageFocus();
      runtime.hosts?.refresh();
      void props
        .onSessionCheck()
        .then(retryHosts)
        .then(() => {
          if (state.status === "online") return Date.now() - syncedAt < FOCUS_RESYNC_MS ? undefined : resync();
          if (state.recovery?.phase !== "suspended") recoverNow();
        })
        .catch(report);
    };
    const visibility = () => {
      pageFocus();
      if (document.hidden) {
        hostLifecycle.cancelPending();
        if (hostId && state.status !== "online") generation += 1;
        recovery.setActive(false);
      } else {
        hostLifecycle.resume();
        if (state.status !== "online" && state.recovery?.phase !== "suspended") recoverNow();
      }
    };
    const network = () => {
      if (!document.hidden) recovery.networkRestored();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", network);
    window.addEventListener("focus", focus);
    window.addEventListener("blur", pageFocus);
    return () => {
      disposed = true;
      generation += 1;
      if (readsTimer) clearTimeout(readsTimer);
      readsTimer = null;
      recovery.dispose();
      hostLifecycle.dispose();
      focusUse.dispose();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", network);
      acceptedInvite = null;
      window.removeEventListener("focus", focus);
      window.removeEventListener("blur", pageFocus);
      void runtime.dispose({ sessionsEnded: props.accountSessionEnded?.() ?? false }).catch(() => undefined);
    };
  });
  return {
    state,
    stepLines,
    hostViews,
    shownAgents,
    profiles,
    retryPanels: loadPanels,
    selected,
    conversation,
    runtime,
    preferences,
    orderedHosts,
    duplicatingSectionIds,
    reorderHosts(hostIds: string[]) {
      setServerOrder(hostIds);
      writeWebServerOrder(props.accountId, hostIds);
    },
    onHostEvent(listener: (event: AgentEvent | TeamRealtimeEvent) => void) {
      hostEventListeners.add(listener);
      return () => {
        hostEventListeners.delete(listener);
      };
    },
    onHostNotice(listener: (hostId: string, event: WebHostNotice, agents: ClientAgentSummary[]) => void) {
      hostNoticeListeners.add(listener);
      return () => {
        hostNoticeListeners.delete(listener);
      };
    },
    run,
    refreshHosts,
    setHostAppearance,
    leaveHost,
    removeOwnedHost,
    setHostHidden,
    canHideHosts: runtime.setHostHidden !== undefined,
    retryHosts,
    reconnect,
    restartRequested,
    useHere,
    joinInvite,
    connect,
    select,
    refresh,
    send,
    cancelQueued: (deliveryId: string, recipientAgentId?: string) =>
      changeQueue((agentId) => runtime.cancelQueued({ agentId: recipientAgentId ?? agentId, deliveryId })),
    steerQueued(deliveryId: string) {
      const expectedTurnId = conversation()?.page?.activeTurnId;
      if (!expectedTurnId) return;
      changeQueue((agentId) =>
        runtime.steerQueued({ agentId, deliveryId, expectedTurnId }).catch((error: unknown) => {
          const delivery = state.queues[agentId]?.deliveries.find((item) => item.id === deliveryId);
          if (delivery && delivery.status !== "queued") return;
          throw error;
        }),
      );
    },
    reorderQueue: (deliveryIds: string[]) => changeQueue((agentId) => runtime.reorderQueue({ agentId, deliveryIds })),
    async updateQueued(
      deliveryId: string,
      text: string,
      keepAttachmentIds: string[],
      attachmentDraftIds: string[],
      target?: { agentId: string; serverId: string },
    ): Promise<boolean> {
      const agentId = target?.agentId ?? selectedId;
      if (!agentId) return false;
      if (target && target.serverId !== hostId) {
        report(new Error(currentText().t("webClient.error.hostChanged")));
        return false;
      }
      const current = generation;
      try {
        await runtime.updateQueued({ agentId, deliveryId, text, keepAttachmentIds, attachmentDraftIds });
        return true;
      } catch (error) {
        if (current === generation) report(error);
        return false;
      }
    },
    markRead,
    markAgentRead,
    markAllRead,
    markUnreadFrom,
    markLatestReplyUnread,
    async deleteMessage(agentId: string, messageId: string): Promise<void> {
      const remove = runtime.deleteMessage;
      if (state.status !== "online" || !remove || !state.capabilities.includes(MESSAGE_DELETE_CAPABILITY))
        throw new Error(currentText().t("error.team.messageDeleteUnsupported"));
      const current = generation;
      await remove({ kind: "agent", agentId, messageId });
      if (disposed || current !== generation) return;
      setState((draft) => {
        const item = draft.conversations[agentId];
        const page = item?.page;
        if (!item || !page) return;
        page.messages = page.messages.filter((message) => message.id !== messageId);
        delete page.references[messageId];
        item.missingReferences = { ...item.missingReferences, [messageId]: true };
      });
    },
    async mutateSidebarLayout(action: SidebarLayoutAction) {
      if (state.status !== "online" || !state.capabilities.includes("sidebar-layout")) {
        throw new Error(currentText().t("webClient.error.sidebarLayout"));
      }
      const mutate = runtime.mutateSidebarLayout;
      if (!mutate) throw new Error(currentText().t("webClient.error.sidebarLayout"));
      const current = generation;
      const layout = await mutate(action);
      if (disposed || current !== generation) return;
      setState((draft) => {
        if (layout.revision >= draft.sidebarLayout.revision) draft.sidebarLayout = layout;
      });
    },
    async duplicateAgent(agentId: string): Promise<void> {
      if (state.status !== "online" || !state.capabilities.includes("agent-duplication")) return;
      if (!state.agents.some((agent) => agent.id === agentId)) return;
      if (state.duplicatingAgentIds.includes(agentId)) return;
      const current = generation;
      setState((draft) => {
        draft.duplicatingAgentIds = [...draft.duplicatingAgentIds, agentId];
        draft.error = null;
      });
      try {
        const result = await runtime.duplicateAgent(agentId);
        if (disposed || current !== generation) return;
        setState((draft) => {
          draft.agents = [result.agent, ...draft.agents.filter((agent) => agent.id !== result.agent.id)];
          if (result.layout.revision >= draft.sidebarLayout.revision) draft.sidebarLayout = result.layout;
        });
        await select(result.agent.id);
      } catch (error) {
        if (current === generation) report(error);
        throw error;
      } finally {
        if (current === generation && !disposed)
          setState((draft) => {
            draft.duplicatingAgentIds = draft.duplicatingAgentIds.filter((id) => id !== agentId);
          });
      }
    },
    async duplicateSection(sectionId: string): Promise<void> {
      if (
        state.status !== "online" ||
        !state.capabilities.includes("agent-duplication") ||
        !state.capabilities.includes("sidebar-layout")
      ) {
        return;
      }
      const mutate = runtime.mutateSidebarLayout;
      if (!mutate || duplicatingSectionIds().has(sectionId)) return;
      const current = generation;
      const isCurrent = () => !disposed && current === generation;
      const acceptLayout = (layout: SidebarLayoutSnapshot) =>
        setState((draft) => {
          if (layout.revision >= draft.sidebarLayout.revision) draft.sidebarLayout = layout;
        });
      setDuplicatingSectionIds((ids) => new Set(ids).add(sectionId));
      try {
        const hidden = new Set(state.userHiddenAgents.map((entry) => entry.agentId));
        await duplicateSectionWith(
          {
            layout: state.sidebarLayout,
            agentIds: state.agents.filter((agent) => !hidden.has(agent.id)).map((agent) => agent.id),
            duplicateAgent: async (agentId) => {
              if (!isCurrent()) return null;
              setState((draft) => {
                draft.duplicatingAgentIds = [...draft.duplicatingAgentIds, agentId];
              });
              try {
                const result = await runtime.duplicateAgent(agentId);
                if (!isCurrent()) return null;
                setState((draft) => {
                  draft.agents = [result.agent, ...draft.agents.filter((agent) => agent.id !== result.agent.id)];
                });
                acceptLayout(result.layout);
                return { agentId: result.agent.id, layout: result.layout };
              } finally {
                if (isCurrent())
                  setState((draft) => {
                    draft.duplicatingAgentIds = draft.duplicatingAgentIds.filter((id) => id !== agentId);
                  });
              }
            },
            mutateLayout: async (action) => {
              if (!isCurrent()) return null;
              const layout = await mutate(action);
              if (!isCurrent()) return null;
              acceptLayout(layout);
              return layout;
            },
          },
          sectionId,
        );
      } catch (error) {
        if (current === generation) report(error);
        throw error;
      } finally {
        setDuplicatingSectionIds((ids) => {
          const next = new Set(ids);
          next.delete(sectionId);
          return next;
        });
      }
    },
    async setAgentHidden(agentId: string, hidden: boolean): Promise<boolean> {
      const write = runtime.setAgentHidden;
      if (state.status !== "online" || !state.capabilities.includes(AGENT_HIDDEN_CAPABILITY) || !write) return false;
      if (!state.agents.some((agent) => agent.id === agentId)) return false;
      if (state.userHiddenAgents.some((entry) => entry.agentId === agentId) === hidden) return false;
      const current = generation;
      const previous = state.userHiddenAgents.find((entry) => entry.agentId === agentId);
      const apply = (entry: HiddenAgent | undefined) =>
        setState((draft) => {
          const others = draft.userHiddenAgents.filter((candidate) => candidate.agentId !== agentId);
          draft.userHiddenAgents = entry ? [...others, entry] : others;
        });
      apply(hidden ? { agentId, hiddenAt: new Date().toISOString() } : undefined);
      try {
        const snapshot = await write({ agentId, hidden });
        if (disposed || current !== generation) return true;
        setState((draft) => {
          draft.userHiddenAgents = snapshot.agents;
        });
        return true;
      } catch (error) {
        if (!disposed && current === generation) apply(previous);
        throw error;
      }
    },
    async deleteAgent(agentId: string): Promise<void> {
      if (state.status !== "online") throw new Error(currentText().t("webClient.error.deleteOffline"));
      if (state.host && !canAdministerServer(state.host.role))
        throw new Error(currentText().t("error.team.membersCannotDeleteAgents"));
      if (!state.agents.some((agent) => agent.id === agentId)) return;
      const current = generation;
      const wasSelected = selectedId === agentId;
      try {
        await runtime.deleteAgent(agentId);
        preferences.removePinnedSidebarItemEverywhere({ kind: "agent", id: agentId });
        if (disposed || current !== generation) return;
        const agents = await runtime.listAgents();
        const sidebarLayout = await readSidebarLayout(
          state.capabilities,
          agents.map((agent) => agent.id),
        );
        if (disposed || current !== generation) return;
        reconcileAgents(agents);
        setState((draft) => {
          if (sidebarLayout.revision >= draft.sidebarLayout.revision) draft.sidebarLayout = sidebarLayout;
        });
        if (wasSelected && selectedId === null && agents[0]) await select(agents[0].id);
      } catch (error) {
        if (current === generation) report(error);
        throw error;
      }
    },
    async answer(input: RespondToPromptInput) {
      const current = generation;
      await runtime.answer(input);
      if (disposed || current !== generation) return;
      forgetListedPrompt(input.requestId);
      setState((draft) => {
        draft.prompts = draft.prompts.filter((item) => String(item.requestId) !== String(input.requestId));
      });
      await refresh();
    },
    async respondToBrowserTakeover(
      decision: "complete" | "cancel",
      sideThreadId?: string,
      options?: PromptAnswerOptions,
    ) {
      const current = generation;
      const threadId = sideThreadId ?? state.agents.find((agent) => agent.id === selectedId)?.threadId;
      const request = state.takeovers.find((item) => item.agentId === selectedId && item.threadId === threadId);
      if (!request) return false;
      try {
        await runtime.respondToTakeover({ requestId: request.requestId, decision });
        if (disposed || current !== generation) return false;
        setState((draft) => {
          draft.takeovers = draft.takeovers.filter((item) => String(item.requestId) !== String(request.requestId));
        });
        return true;
      } catch (error) {
        if (current !== generation) return false;
        if (options?.onError) options.onError(error);
        else report(error);
        return false;
      }
    },
    activateBrowserTab(tabId: string) {
      if (state.browserTabs.some((tab) => tab.id === tabId))
        setState((draft) => {
          draft.activeBrowserTabId = tabId;
        });
    },
    noticeBrowserTabs(tabIds: readonly string[]) {
      const noticed = state.noticedBrowserTabIds;
      const added = noticed ? tabIds.filter((tabId) => !noticed.includes(tabId)) : [];
      if (added.length > 0)
        setState((draft) => {
          draft.noticedBrowserTabIds?.push(...added);
        });
    },
    async openSearchMessage(messageId: string): Promise<boolean> {
      const id = selectedId;
      const current = generation;
      if (!id) return false;
      const loaded = () => state.conversations[id]?.page?.messages.some((message) => message.id === messageId) === true;
      if (loaded()) return true;
      const readAround = runtime.conversationAround;
      try {
        if (readAround && state.capabilities.includes("conversation-pagination")) {
          const request = (aroundReads.get(id) ?? 0) + 1;
          aroundReads.set(id, request);
          const page = await readAround(id, messageId);
          if (disposed || current !== generation || selectedId !== id || aroundReads.get(id) !== request) return false;
          if (loaded()) return true;
          if (page.agentId !== id || !page.messages.some((message) => message.id === messageId)) return false;
          setState((draft) => {
            const item = draft.conversations[id];
            if (!item) return;
            item.page = { ...page, messages: [...page.messages] };
            item.missingReferences = missingReplyOriginals(page);
            item.around = true;
            item.trimmed = false;
            item.loading = false;
            item.error = null;
            item.olderError = null;
          });
          return true;
        }
        while (!state.conversations[id]?.page?.messages.some((message) => message.id === messageId)) {
          const page = state.conversations[id]?.page;
          if (!page?.pageInfo.hasOlder || !page.pageInfo.olderCursor) break;
          const cursor = page.pageInfo.olderCursor;
          await load(id, true);
          if (disposed || current !== generation || selectedId !== id) return false;
          if (state.conversations[id]?.page?.pageInfo.olderCursor === cursor) break;
        }
      } catch (error) {
        if (current === generation) report(error);
        return false;
      }
      return !disposed && current === generation && loaded();
    },
    loadLatest() {
      const id = selectedId;
      if (!id) return Promise.resolve();
      aroundReads.set(id, (aroundReads.get(id) ?? 0) + 1);
      setState((draft) => {
        const item = draft.conversations[id];
        if (!item?.around) return;
        item.around = false;
        item.trimmed = true;
      });
      return refresh();
    },
    async approve(input: RespondToApprovalInput) {
      const current = generation;
      await runtime.approve(input);
      if (disposed || current !== generation) return;
      setState((draft) => {
        draft.approvals = draft.approvals.filter((item) => item.requestId !== input.requestId);
      });
      await refresh();
    },
    readMediaApproval(input: ReadMediaApprovalInput) {
      return runtime.readMediaApproval?.(input) ?? Promise.resolve({ media: null, hold: null });
    },
    async respondToCreditsHold(input: RespondToCreditsHoldInput) {
      const respond = runtime.respondToCreditsHold;
      if (!respond) throw new Error(currentText().t("error.team.mediaApprovalChoiceUnsupported"));
      const current = generation;
      const hold = await respond(input);
      if (hold || disposed || current !== generation) return hold;
      setState((draft) => {
        draft.approvals = draft.approvals.filter((item) => item.requestId !== input.requestId);
      });
      await refresh();
      return hold;
    },
    async setCreditsAskMuted(muted: boolean) {
      const setMuted = runtime.setCreditsAskMuted;
      if (!setMuted) throw new Error(currentText().t("error.team.mediaApprovalChoiceUnsupported"));
      await setMuted({ muted });
    },
    async readCreditsAskMuted() {
      const read = runtime.readCreditsAskMuted;
      if (!read) throw new Error(currentText().t("error.team.mediaApprovalChoiceUnsupported"));
      return read();
    },
    async respondToMediaApproval(input: RespondToMediaApprovalInput) {
      const respond = runtime.respondToMediaApproval;
      if (!respond) throw new Error(currentText().t("error.team.mediaApprovalChoiceUnsupported"));
      const current = generation;
      await respond(input);
      if (disposed || current !== generation) return;
      setState((draft) => {
        draft.approvals = draft.approvals.filter((item) => item.requestId !== input.requestId);
      });
      await refresh();
    },
    older: () => {
      const id = selectedId;
      return id ? run(() => load(id, true).catch(() => undefined)) : Promise.resolve();
    },
    setDraft(text: string) {
      const id = selectedId;
      if (id)
        setState((draft) => {
          const conversation = draft.conversations[id];
          if (conversation) conversation.draft = text;
        });
    },
    async upload(file: File) {
      const id = selectedId;
      if (!id) return;
      if ((state.conversations[id]?.attachments.length ?? 0) >= INPUT_LIMITS.attachments) {
        report(new Error(currentText().t("webClient.error.attachmentLimit", { limit: INPUT_LIMITS.attachments })));
        return;
      }
      const current = generation;
      await run(async () => {
        setState((draft) => {
          draft.uploading = true;
        });
        try {
          const attachment = await runtime.upload(file);
          if (current !== generation || disposed) return;
          if (!state.conversations[id]) {
            await runtime.discard(attachment.id);
            return;
          }
          setState((draft) => {
            draft.conversations[id]?.attachments.push(attachment);
          });
        } finally {
          if (!disposed)
            setState((draft) => {
              draft.uploading = false;
            });
        }
      });
    },
    cancelUpload: () => runtime.cancelUpload().catch(report),
    toggleHidden(id: string) {
      setState((draft) => {
        draft.hiddenIds = draft.hiddenIds.includes(id)
          ? draft.hiddenIds.filter((value) => value !== id)
          : [...draft.hiddenIds, id];
      });
    },
    toggleNotifications: () =>
      run(async () => {
        const agent = state.agents.find((value) => value.id === selectedId);
        if (!agent) return;
        const current = generation;
        await runtime.updateAgent({ agentId: agent.id, notifications: !agent.notifications });
        const agents = await runtime.listAgents();
        if (!disposed && current === generation)
          setState((draft) => {
            draft.agents = agents;
          });
      }),
    async discard(attachmentId: string) {
      const id = selectedId;
      const current = generation;
      if (!id) return;
      await run(async () => {
        await runtime.discard(attachmentId);
        if (current === generation && !disposed)
          setState((draft) => {
            const conversation = draft.conversations[id];
            if (conversation)
              conversation.attachments = conversation.attachments.filter((item) => item.id !== attachmentId);
          });
      });
    },
  };
}

const FOCUS_RESYNC_MS = 30_000;

function changedConversation(event: AgentEvent | TeamRealtimeEvent): string | undefined {
  switch (event.type) {
    case "conversation":
      return event.snapshot.agentId;
    case "conversation-page":
      return event.page.agentId;
    case "conversation-invalidated":
    case "turn-started":
    case "turn-completed":
    case "prompt":
    case "agent-input-resolved":
      return event.agentId;
    default:
      return undefined;
  }
}

function presenceWithChatColors(
  presence: TeamPresenceSnapshot,
  colors: readonly MemberChatColorEntry[],
): TeamPresenceSnapshot {
  const byMember = new Map(colors.map((entry) => [entry.memberId, entry.color]));
  return {
    ...presence,
    members: presence.members.map(({ chatColor: _chatColor, ...member }) => {
      const color = byMember.get(member.id);
      return color ? { ...member, chatColor: color } : member;
    }),
  };
}
