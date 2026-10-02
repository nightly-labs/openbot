import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentApproval,
  AgentEvent,
  AgentRuntimeApproval,
  AgentStatus,
  AgentSummary,
  AttachmentSummary,
  BrowserControlState,
  BrowserTab,
  BrowserTakeoverRequest,
  ConversationPage,
  HostedServerSleep,
  QueueSnapshot,
  RespondToApprovalInput,
  RespondToPromptInput,
  SidebarLayoutAction,
  SidebarLayoutSnapshot,
  TeamPresenceSnapshot,
  TeamRealtimeEvent,
} from "@openbot/contracts/ipc";
import { cleanAgentMessageText } from "@openbot/team-client/agent-message-text";
import { WAKE_RECONNECT_DELAY_MS } from "@openbot/team-client/hosted-server-wake";
import type { RemoteTeamHost } from "@openbot/team-client/remote-directory";
import { reconcilePendingRequests } from "@openbot/team-client/runtime-attention";
import { currentText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, createStore, onSettled } from "solid-js";
import { toAgentProfile } from "../../app-message-projection";
import { mergeConversationPage } from "../conversation/conversation-merge";
import { createSidebarPreferences } from "../sidebar/sidebar-preferences";
import { defaultSidebarLayout } from "../sidebar/sidebar-sections";
import { createHostRestartToasts } from "../updates/host-restart-toast";
import type { WebHostNotice } from "./web-host-connections";
import type { WebHostState } from "./web-host-lock";
import { createWebHostedServerWake } from "./web-hosted-server-wake";
import {
  createWebWorkspaceRuntime,
  WebHostIncompatibleError,
  type WebRuntimeEvents,
  type WebWorkspaceRuntime,
} from "./web-runtime";
import { orderWebHosts, readWebServerOrder, writeWebServerOrder } from "./web-server-order";

interface WebConversation {
  page: ConversationPage | null;
  draft: string;
  attachments: AttachmentSummary[];
  loading: boolean;
  sending: boolean;
  uncertain: boolean;
  /** Why the last send failed. The composer shows it; it is not a workspace error. */
  sendError: string | null;
}
interface WebWorkspaceState {
  hosts: RemoteTeamHost[];
  host: RemoteTeamHost | null;
  agents: AgentSummary[];
  /** The host answered an agent list. Until then, an empty `agents` does not mean the host has none. */
  agentsLoaded: boolean;
  selectedId: string | null;
  conversations: Record<string, WebConversation>;
  /** The queues read from the host, by agent. Each agent's queue is read on connect and on each change. */
  queues: Record<string, QueueSnapshot>;
  approvals: Array<AgentApproval | AgentRuntimeApproval>;
  prompts: Array<Extract<AgentEvent, { type: "prompt" }>>;
  /** The latest progress detail of each agent's running turn. */
  progress: Record<string, { turnId: string; detail: string }>;
  takeovers: BrowserTakeoverRequest[];
  browserTabs: BrowserTab[];
  activeBrowserTabId: string | null;
  browserControlState: BrowserControlState;
  /** Who is on the connected host. Null until the host answers. */
  presence: TeamPresenceSnapshot | null;
  capabilities: string[];
  status: "connecting" | "online" | "offline";
  /**
   * The opened host is a hosted server that the account service stopped for no use (`sleeping`), or that
   * starts after the user's input (`waking`). Cleared when it is online again.
   */
  hostedSleep: HostedServerSleep | null;
  /** The opened host said it restarts into an update (`host-update-v1`). Cleared when it is online again. */
  hostRestart: { state: "waiting" | "restarting"; version: string | null } | null;
  /** The state of each host that this tab has not opened, from its status connection. */
  hostStates: Record<string, WebHostState>;
  /** The last connection found that the host speaks no protocol this build speaks. */
  incompatibility: {
    hostId: string;
    code: WebHostIncompatibleError["code"];
    message: string;
    hostAppVersion: string;
    hostProtocol: { minimum: number; maximum: number };
  } | null;
  hostsLoaded: boolean;
  hostsLoading: boolean;
  hostsError: string | null;
  revocationRevision: number;
  error: string | null;
  busy: boolean;
  uploading: boolean;
  hiddenIds: string[];
  /** The team member this connection signs in as, once the host has answered. */
  memberId: string | null;
  duplicatingAgentIds: string[];
  sidebarLayout: SidebarLayoutSnapshot;
}
/** A host restarts in under a minute; the retries stop after three. */
const HOST_RESTART_RETRY_MS = 5_000;
const HOST_RESTART_RETRY_LIMIT = 36;
/** A sleeping server can start for a routine. The tab asks the account service again after this long. */
const SLEEP_RECHECK_MS = 5 * 60_000;

export type WebRuntimeFactory = (
  accountId: string,
  events: WebRuntimeEvents,
  accountFetch: typeof fetch,
) => WebWorkspaceRuntime;

export function createWebWorkspace(
  props: {
    accountId: string;
    accountFetch: typeof fetch;
    onSessionCheck: () => Promise<void>;
    /** Read when the workspace closes: true when its account session has ended. */
    accountSessionEnded?: () => boolean;
    createRuntime?: WebRuntimeFactory;
  },
  hooks: {
    /** A new agent status of the connected host, such as the end of a provider sign-in. */
    onStatus?: (status: AgentStatus) => void;
  } = {},
) {
  const [state, setState] = createStore<WebWorkspaceState>({
    hosts: [],
    host: null,
    agents: [],
    agentsLoaded: false,
    selectedId: null,
    conversations: {},
    queues: {},
    approvals: [],
    prompts: [],
    progress: {},
    takeovers: [],
    browserTabs: [],
    activeBrowserTabId: null,
    browserControlState: { sessions: [] },
    presence: null,
    capabilities: [],
    status: "offline",
    hostedSleep: null,
    hostRestart: null,
    hostStates: {},
    incompatibility: null,
    hostsLoaded: false,
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
  });
  let generation = 0;
  let selectedId: string | null = null;
  let hostId: string | null = null;
  let disposed = false;
  let running = false;
  let pendingReload = false;
  let reloadPromise: Promise<void> | null = null;
  let hostsRefreshPromise: Promise<void> | null = null;
  let acceptedInvite: { inviteUrl: string; host: RemoteTeamHost } | null = null;
  /** Set when a revoked session connects again by itself; cleared when the host is online. */
  let revokedReconnect = false;
  /** The next reconnect to a host that restarts into an update. The opened host has no other retry. */
  let restartRetry: ReturnType<typeof setTimeout> | null = null;
  /** The queue read in flight by agent. An event during a read asks for one more read. */
  const queueLoads = new Map<string, { generation: number; again: boolean }>();
  /** Counts queue snapshots from events by agent. A read that started before a newer snapshot is dropped. */
  const queueRevisions = new Map<string, number>();
  const readWrites = new Map<string, Promise<void>>();
  /** The conversation reads in flight by agent, and the deltas that wait for them to finish. */
  const conversationReads = new Map<string, number>();
  const heldDeltas = new Map<string, Array<Extract<AgentEvent, { type: "conversation-delta" }>>>();
  const hostEventListeners = new Set<(event: AgentEvent | TeamRealtimeEvent) => void>();
  const hostedServer = createWebHostedServerWake(props.accountFetch);
  let wakeReconnectTimer: number | undefined;
  let sleepRecheckTimer: number | undefined;
  /** Removes the listeners that wait for the user's input while the opened server sleeps. */
  let stopWaitingForInput: (() => void) | null = null;
  const hostNoticeListeners = new Set<(hostId: string, event: WebHostNotice, agents: AgentSummary[]) => void>();
  const runtime = (props.createRuntime ?? createWebWorkspaceRuntime)(
    props.accountId,
    {
      accountChanged: props.onSessionCheck,
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
      connection(update) {
        if (disposed || update.hostId !== hostId) return;
        setState((draft) => {
          draft.status = update.state;
          draft.error = update.message;
          if (update.state !== "online") {
            draft.approvals = [];
            draft.prompts = [];
            draft.progress = {};
            draft.takeovers = [];
            draft.browserTabs = [];
            draft.activeBrowserTabId = null;
            draft.browserControlState = { sessions: [] };
            draft.sidebarLayout = defaultSidebarLayout();
            draft.duplicatingAgentIds = [];
          }
        });
        if (update.code === "session_revoked") {
          // A revoked session must not leave private conversations visible while the directory
          // decides whether this membership still exists. Keep the host shell for a possible
          // authorized reconnect, but invalidate every private read and pending action now.
          generation += 1;
          selectedId = null;
          setState((draft) => {
            draft.revocationRevision += 1;
            draft.agents = [];
            draft.agentsLoaded = false;
            draft.conversations = {};
            draft.queues = {};
            draft.selectedId = null;
            draft.approvals = [];
            draft.prompts = [];
            draft.progress = {};
            draft.takeovers = [];
            draft.browserTabs = [];
            draft.activeBrowserTabId = null;
            draft.browserControlState = { sessions: [] };
            draft.sidebarLayout = defaultSidebarLayout();
            draft.capabilities = [];
            draft.presence = null;
            draft.duplicatingAgentIds = [];
          });
          const revokedHostId = hostId;
          const revokedGeneration = generation;
          void props
            .onSessionCheck()
            .then(() => refreshHosts())
            .then(() => {
              // A member or role change anywhere on the host revokes every session, this one
              // too. The directory still lists the host, so this account can connect again.
              // Try once: a second revocation before the host is online waits for Reconnect.
              // The directory copy has the new role; `state.host` keeps the role of the last connect.
              const host = state.hosts.find((listed) => listed.hostId === revokedHostId);
              if (disposed || revokedReconnect || hostId !== revokedHostId || generation !== revokedGeneration || !host)
                return;
              revokedReconnect = true;
              return connect({ ...host });
            })
            .catch(report);
          return;
        }
        // A host that announced a restart comes back by itself; a wake is only for a stopped server.
        if (update.state === "offline" && !update.code && !state.hostRestart) hostUnavailable(update.hostId);
        if (update.state === "online") {
          revokedReconnect = false;
          endSleep();
        } else if (state.hostRestart) retryAfterRestart();
        if (update.state === "online" && update.resync) {
          // A host that still waits to restart says so again when the connection declares capabilities.
          setState((draft) => {
            draft.hostRestart = null;
          });
          void resync();
        }
      },
      event(id, event) {
        if (disposed || id !== hostId) return;
        for (const listener of hostEventListeners) listener(event);
        if (event.type === "team-presence")
          setState((draft) => {
            draft.presence = event.snapshot;
          });
        if (event.type === "host-restart")
          setState((draft) => {
            draft.hostRestart = event.state === "none" ? null : { state: event.state, version: event.version };
          });
        if (event.type === "status") hooks.onStatus?.(event.status);
        if (event.type === "runtime-snapshot") {
          const { attentionComplete } = event.snapshot;
          setState((draft) => {
            draft.approvals = reconcilePendingRequests(
              draft.approvals,
              event.snapshot.pendingApprovals,
              attentionComplete,
            );
            draft.prompts = reconcilePendingRequests(
              draft.prompts,
              event.snapshot.pendingPrompts.map((prompt) => ({ ...prompt, type: "prompt" as const })),
              attentionComplete,
            );
            draft.takeovers = reconcilePendingRequests(
              draft.takeovers,
              event.snapshot.pendingBrowserTakeovers,
              attentionComplete,
            );
          });
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
          setState((draft) => {
            draft.approvals = draft.approvals.filter((item) => String(item.requestId) !== String(event.requestId));
            draft.prompts = draft.prompts.filter((item) => String(item.requestId) !== String(event.requestId));
          });
        } else if (event.type === "turn-progress") {
          setState((draft) => {
            draft.progress[event.agentId] = { turnId: event.turnId, detail: cleanAgentMessageText(event.detail) };
          });
        } else if (event.type === "turn-started") {
          setState((draft) => {
            delete draft.progress[event.agentId];
          });
        } else if (event.type === "conversation-delta") {
          applyDelta(event);
        } else if (event.type === "turn-completed") {
          setState((draft) => {
            if (draft.progress[event.agentId]?.turnId === event.turnId) delete draft.progress[event.agentId];
            draft.prompts = draft.prompts.filter(
              (item) =>
                item.agentId !== event.agentId || item.threadId !== event.threadId || item.turnId !== event.turnId,
            );
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
            draft.browserTabs = event.tabs;
            draft.activeBrowserTabId = event.activeTabId;
          });
        if (event.type === "browser-control-changed")
          setState((draft) => {
            draft.browserControlState = event.state;
          });
        if (event.type === "agents-changed") {
          reconcileAgents(event.agents);
          for (const agent of event.agents) if (!state.queues[agent.id]) loadQueue(agent.id);
        }
        if (event.type === "queue-changed") {
          const { snapshot } = event;
          queueRevisions.set(snapshot.agentId, (queueRevisions.get(snapshot.agentId) ?? 0) + 1);
          setState((draft) => {
            draft.queues[snapshot.agentId] = snapshot;
          });
        }
        if (event.type === "queue-invalidated" && state.agents.some((agent) => agent.id === event.agentId))
          loadQueue(event.agentId);
        if (event.type === "sidebar-layout-changed")
          setState((draft) => {
            if (event.layout.revision >= draft.sidebarLayout.revision) draft.sidebarLayout = event.layout;
          });
        if (
          [
            "conversation",
            "conversation-page",
            "conversation-invalidated",
            "turn-started",
            "turn-completed",
            "prompt",
            "agent-input-resolved",
          ].includes(event.type)
        )
          void refresh();
      },
    },
    props.accountFetch,
  );
  const preferences = createSidebarPreferences({
    scope: () => (state.host ? `${props.accountId}:${state.host.hostId}` : ""),
  });
  // The other tabs show the opened host with the state this tab has for it.
  createEffect(
    () => ({ id: state.host?.hostId, status: state.status }),
    ({ id, status }) => {
      if (id) runtime.hosts?.reportSelected(id, status);
    },
  );
  const [serverOrder, setServerOrder] = createSignal(readWebServerOrder(props.accountId));
  const orderedHosts = createMemo(() => orderWebHosts(state.hosts, serverOrder()));
  const profiles = createMemo(() => state.agents.map(toAgentProfile));
  const selected = createMemo(() => profiles().find((agent) => agent.id === state.selectedId));
  const conversation = createMemo(() => (state.selectedId ? state.conversations[state.selectedId] : undefined));

  function report(error: unknown) {
    if (!disposed)
      setState((draft) => {
        draft.error = error instanceof Error ? error.message : currentText().t("webClient.error.requestFailed");
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
  function reconcileAgents(agents: AgentSummary[]): void {
    const ids = new Set(agents.map((agent) => agent.id));
    const nextSelected = selectedId && ids.has(selectedId) ? selectedId : null;
    selectedId = nextSelected;
    setState((draft) => {
      const removed = draft.agents.filter((agent) => !ids.has(agent.id)).map((agent) => agent.id);
      draft.agents = agents;
      draft.agentsLoaded = true;
      draft.hiddenIds = draft.hiddenIds.filter((id) => ids.has(id));
      draft.duplicatingAgentIds = draft.duplicatingAgentIds.filter((id) => ids.has(id));
      for (const id of removed) {
        delete draft.conversations[id];
        delete draft.queues[id];
        delete draft.progress[id];
      }
      if (nextSelected === null) draft.selectedId = null;
      // The layout also orders channels, so only the agents that left may be dropped from it.
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
  function refreshHosts(): Promise<void> {
    if (hostsRefreshPromise) return hostsRefreshPromise;
    const refreshGeneration = generation;
    const refreshHostId = hostId;
    const promise = (async () => {
      if (disposed) return;
      setState((draft) => {
        draft.hostsLoading = true;
        draft.hostsError = null;
      });
      try {
        const hosts = await runtime.listHosts();
        if (disposed) return;
        const activeGeneration = refreshGeneration === generation && refreshHostId === hostId;
        if (!activeGeneration) return;
        if (refreshHostId && !hosts.some((host) => host.hostId === refreshHostId)) {
          generation += 1;
          hostId = null;
          selectedId = null;
          setState((draft) => {
            draft.host = null;
            draft.memberId = null;
            draft.selectedId = null;
            draft.agents = [];
            draft.agentsLoaded = false;
            draft.conversations = {};
            draft.queues = {};
            draft.approvals = [];
            draft.prompts = [];
            draft.progress = {};
            draft.takeovers = [];
            draft.browserTabs = [];
            draft.activeBrowserTabId = null;
            draft.browserControlState = { sessions: [] };
            draft.sidebarLayout = defaultSidebarLayout();
            draft.duplicatingAgentIds = [];
            draft.capabilities = [];
            draft.status = "offline";
            draft.error = currentText().t("webClient.error.accessEnded");
          });
          // First, so the host that left does not get a status connection when it stops being open.
          runtime.hosts?.setHosts(hosts);
          await runtime.disconnect().catch(() => undefined);
        }
        const connected = hosts.find((host) => host.hostId === hostId);
        setState((draft) => {
          // The connected host is a copy from `connect`. An admin can rename it while connected.
          if (connected && draft.host?.hostId === connected.hostId) {
            draft.host.name = connected.name;
            draft.host.logoKey = connected.logoKey;
          }
          draft.hosts = hosts;
          draft.hostsLoaded = true;
          draft.hostsError = null;
        });
        const first = orderWebHosts(hosts, serverOrder())[0];
        if (!hostId && first) await connect(first);
        // After the opened host, so it takes its Signal connection before the status connections.
        if (!disposed) runtime.hosts?.setHosts(hosts);
      } catch (error) {
        if (!disposed) {
          const message = error instanceof Error ? error.message : currentText().t("webClient.error.hostsFailed");
          setState((draft) => {
            draft.hostsError = message;
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
  function retryHosts(): Promise<void> {
    return refreshHosts().catch(() => undefined);
  }
  /**
   * The opened host is offline. A hosted server that the account service stopped for no use waits for the
   * user's input. Another stopped hosted server starts, and the tab connects again. A server that starts
   * already is asked to start again, with no status read in between.
   */
  function hostUnavailable(id: string): void {
    const starting = state.hostedSleep === "waking";
    void (starting ? hostedServer.wake(id) : Promise.resolve(false)).then(async (waking) => {
      const availability = waking ? "waking" : await hostedServer.unavailable(id);
      if (disposed || hostId !== id || state.status === "online") return;
      // The 5-minute recheck can find that the server does not sleep now, so input does not wake it.
      if (availability !== "sleeping") stopWaitingForInput?.();
      setHostedSleep(availability === "sleeping" ? "sleeping" : availability === "waking" ? "waking" : null);
      if (availability === "waking") reconnectAfterWake(id);
      else if (availability === "sleeping") waitForInput(id);
    });
  }
  function reconnectAfterWake(id: string): void {
    window.clearTimeout(wakeReconnectTimer);
    wakeReconnectTimer = window.setTimeout(() => {
      if (!disposed && hostId === id && state.status === "offline") void reconnect().catch(report);
    }, WAKE_RECONNECT_DELAY_MS);
  }
  /** The next key or pointer press in the tab starts the sleeping server. */
  function waitForInput(id: string): void {
    stopWaitingForInput?.();
    const onInput = () => {
      stopWaitingForInput?.();
      if (disposed || hostId !== id || state.status === "online") return;
      setHostedSleep("waking");
      void hostedServer.wakeForInput(id).then((waking) => {
        if (disposed || hostId !== id || state.status === "online") return;
        if (waking) reconnectAfterWake(id);
        else {
          setHostedSleep(null);
          hostUnavailable(id);
        }
      });
    };
    window.addEventListener("pointerdown", onInput, true);
    window.addEventListener("keydown", onInput, true);
    sleepRecheckTimer = window.setTimeout(() => hostUnavailable(id), SLEEP_RECHECK_MS);
    stopWaitingForInput = () => {
      window.removeEventListener("pointerdown", onInput, true);
      window.removeEventListener("keydown", onInput, true);
      window.clearTimeout(sleepRecheckTimer);
      stopWaitingForInput = null;
    };
  }
  function setHostedSleep(hostedSleep: HostedServerSleep | null): void {
    if (state.hostedSleep !== hostedSleep)
      setState((draft) => {
        draft.hostedSleep = hostedSleep;
      });
  }
  function endSleep(): void {
    stopWaitingForInput?.();
    setHostedSleep(null);
  }

  /** `connect` clears `hostRestart`, so the retries count down instead of reading it again. */
  function retryAfterRestart(retries = HOST_RESTART_RETRY_LIMIT): void {
    if (restartRetry || disposed || retries <= 0) return;
    const retryHostId = hostId;
    restartRetry = setTimeout(() => {
      restartRetry = null;
      if (disposed || hostId !== retryHostId || state.status === "online") return;
      void reconnect()
        .catch(() => undefined)
        .then(() => {
          if (!disposed && hostId === retryHostId && state.status !== "online") retryAfterRestart(retries - 1);
        });
    }, HOST_RESTART_RETRY_MS);
  }
  async function reconnect(): Promise<void> {
    const host = state.hosts.find((listed) => listed.hostId === state.host?.hostId) ?? state.host;
    if (!host || state.status === "connecting") return;
    await connect({ ...host });
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
  async function connect(host: RemoteTeamHost) {
    if (state.status === "connecting") return;
    const current = ++generation;
    const sameHost = hostId === host.hostId;
    const previousSelected = sameHost ? selectedId : null;
    hostId = host.hostId;
    selectedId = null;
    if (!sameHost) endSleep();
    setState((draft) => {
      draft.host = host;
      draft.status = "connecting";
      draft.hostRestart = null;
      draft.memberId = sameHost ? draft.memberId : null;
      draft.agents = [];
      draft.agentsLoaded = false;
      draft.selectedId = null;
      if (!sameHost) {
        draft.conversations = {};
        draft.queues = {};
        draft.hiddenIds = [];
      } else {
        for (const item of Object.values(draft.conversations)) {
          if (item.sending) {
            item.sending = false;
            item.uncertain = true;
          }
        }
      }
      draft.approvals = [];
      draft.prompts = [];
      draft.progress = {};
      draft.takeovers = [];
      draft.browserTabs = [];
      draft.activeBrowserTabId = null;
      draft.browserControlState = { sessions: [] };
      draft.sidebarLayout = defaultSidebarLayout();
      draft.duplicatingAgentIds = [];
      draft.capabilities = [];
      draft.presence = null;
      draft.error = null;
      draft.incompatibility = null;
    });
    try {
      const capabilities = await runtime.connect(host);
      const agents = await runtime.listAgents();
      const [browserTabs, sidebarLayout] = await Promise.all([
        capabilities.includes("browser-control") ? runtime.browserTabs() : Promise.resolve([]),
        readSidebarLayout(
          capabilities,
          agents.map((agent) => agent.id),
        ),
      ]);
      if (disposed || current !== generation) return;
      revokedReconnect = false;
      endSleep();
      setState((draft) => {
        draft.capabilities = capabilities;
        draft.agents = agents;
        draft.agentsLoaded = true;
        draft.status = "online";
        draft.browserTabs = browserTabs;
        draft.activeBrowserTabId = browserTabs[0]?.id ?? null;
        if (sidebarLayout.revision >= draft.sidebarLayout.revision) draft.sidebarLayout = sidebarLayout;
      });
      preferences.reconcileActiveServerPins(agents.map((agent) => agent.id));
      for (const agent of agents) loadQueue(agent.id);
      void runtime
        .currentMemberId?.()
        .then((memberId) => {
          if (!disposed && current === generation)
            setState((draft) => {
              draft.memberId = memberId;
            });
        })
        .catch(() => undefined);
      // Presence only names people. A host that does not answer leaves the list empty.
      void runtime.admin?.team.getPresence().then(
        (presence) => {
          if (!disposed && current === generation && !state.presence)
            setState((draft) => {
              draft.presence = presence;
            });
        },
        () => undefined,
      );
      const first = agents.find((agent) => agent.id === previousSelected) ?? agents[0];
      if (first) await select(first.id);
    } catch (error) {
      if (disposed || current !== generation) return;
      setState((draft) => {
        draft.status = "offline";
        // The workspace shows an incompatible host in full, so it is not also reported as an error.
        if (error instanceof WebHostIncompatibleError)
          draft.incompatibility = {
            hostId: host.hostId,
            code: error.code,
            message: error.message,
            hostAppVersion: error.hostAppVersion,
            hostProtocol: { ...error.hostProtocol },
          };
      });
      if (!(error instanceof WebHostIncompatibleError)) {
        report(error);
        hostUnavailable(host.hostId);
      }
    }
  }
  async function load(id: string, older = false) {
    const current = generation;
    const previous = state.conversations[id];
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
        const resolvedRequests = new Set(
          page.messages.flatMap((message) =>
            message.questionPrompt?.resolution ? [String(message.questionPrompt.requestId)] : [],
          ),
        );
        draft.prompts = draft.prompts.filter(
          (prompt) =>
            prompt.agentId !== id ||
            prompt.threadId !== page.threadId ||
            !resolvedRequests.has(String(prompt.requestId)),
        );
        item.page = {
          ...page,
          messages: mergeConversationPage(
            old?.messages ?? [],
            page.messages,
            older ? "older" : old ? "latest" : "replace",
          ),
          references: { ...old?.references, ...page.references },
          pageInfo: !older && old ? old.pageInfo : page.pageInfo,
          // An older page has the thread's current revision but not its newest messages. The loaded
          // newest messages keep their revision, so a delta held during this read still applies.
          revision: older && old ? old.revision : page.revision,
        };
        item.loading = false;
      });
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
  /**
   * Appends streamed text to the selected conversation without a read. A delta that arrives during
   * a read waits for it: the page read may already hold the text, and its revision tells which
   * deltas are newer. A delta for another thread asks for a read.
   */
  function applyDelta(event: Extract<AgentEvent, { type: "conversation-delta" }>) {
    if (disposed || event.agentId !== selectedId) return;
    if (conversationReads.has(event.agentId)) {
      heldDeltas.set(event.agentId, [...(heldDeltas.get(event.agentId) ?? []), event]);
      return;
    }
    let otherThread = false;
    // The checks read the draft: a page that a read just wrote is not visible outside it until a flush.
    setState((draft) => {
      const value = draft.conversations[event.agentId]?.page;
      if (!value) return;
      if (value.threadId !== event.threadId) {
        otherThread = true;
        return;
      }
      if (event.revision <= value.revision) return;
      const message = value.messages.find((item) => item.id === event.messageId);
      if (message) {
        message.text += event.delta;
        message.status = "streaming";
      } else
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
  // Coalesce event bursts per agent, as `refresh` does for the conversation.
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
  /** Sends one queue change for the selected agent. The host then sends the new queue as an event. */
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
    setState((draft) => {
      draft.selectedId = id;
      draft.conversations[id] ??= {
        page: null,
        draft: "",
        attachments: [],
        loading: true,
        sending: false,
        uncertain: false,
        sendError: null,
      };
    });
    try {
      await load(id);
    } catch (error) {
      if (disposed || current !== generation) return;
      report(error);
      setState((draft) => {
        if (draft.conversations[id]) draft.conversations[id].loading = false;
      });
    }
  }
  async function resync() {
    const current = generation;
    try {
      const agents = await runtime.listAgents();
      if (disposed || current !== generation) return;
      const sidebarLayout = await readSidebarLayout(
        state.capabilities,
        agents.map((agent) => agent.id),
      );
      if (disposed || current !== generation) return;
      reconcileAgents(agents);
      setState((draft) => {
        if (sidebarLayout.revision >= draft.sidebarLayout.revision) draft.sidebarLayout = sidebarLayout;
      });
      for (const agent of agents) loadQueue(agent.id);
      if (!selectedId && agents[0]) await select(agents[0].id);
      await refresh();
    } catch (error) {
      if (current === generation) report(error);
    }
  }
  // Coalesce event bursts; an event during a read schedules one further authoritative read.
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
  async function send(textOverride?: string, attachmentsOverride?: string[], replyToMessageId: string | null = null) {
    const id = selectedId;
    if (!id || state.status !== "online") return false;
    const item = state.conversations[id];
    if (
      !item ||
      item.sending ||
      item.uncertain ||
      (!(textOverride ?? item.draft).trim() && !(attachmentsOverride ?? item.attachments).length)
    )
      return false;
    const current = generation;
    const text = textOverride ?? item.draft;
    if (text.length > INPUT_LIMITS.messageText) {
      setState((draft) => {
        const conversation = draft.conversations[id];
        if (conversation) conversation.sendError = currentText().t("webClient.error.messageTooLong");
      });
      return false;
    }
    setState((draft) => {
      const conversation = draft.conversations[id];
      if (!conversation) return;
      conversation.sending = true;
      conversation.sendError = null;
    });
    try {
      await runtime.send(
        id,
        text,
        attachmentsOverride ?? item.attachments.map((attachment) => attachment.id),
        replyToMessageId,
      );
      if (current !== generation || disposed) return false;
      setState((draft) => {
        const value = draft.conversations[id];
        if (!value) return;
        value.draft = "";
        value.attachments = [];
      });
      try {
        await refresh();
      } catch (error) {
        if (current === generation) report(error);
      }
      return true;
    } catch {
      if (current !== generation || disposed) return false;
      setState((draft) => {
        const conversation = draft.conversations[id];
        if (!conversation) return;
        conversation.uncertain = true;
        conversation.sendError = currentText().t("webClient.error.deliveryUnconfirmed");
      });
      return false;
    } finally {
      if (current === generation && !disposed)
        setState((draft) => {
          const conversation = draft.conversations[id];
          if (conversation) conversation.sending = false;
        });
    }
  }
  /** Marks the selected agent's messages read through the newest loaded one. Writes for one agent run in order. */
  function markRead() {
    const id = selectedId;
    if (!id || state.status !== "online") return Promise.resolve();
    const current = generation;
    const write = (readWrites.get(id) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        const page = state.conversations[id]?.page;
        if (!page || disposed || current !== generation) return;
        const readState = await runtime.markRead(id, page.messages.at(-1)?.id ?? null);
        if (disposed || current !== generation) return;
        setState((draft) => {
          const value = draft.conversations[id]?.page;
          if (value?.threadId === page.threadId) value.readState = readState;
        });
      });
    readWrites.set(id, write);
    return write;
  }
  /** Marks every agent with unread messages read through its newest one, loaded or not. */
  async function markAllRead() {
    if (state.status !== "online") return;
    const current = generation;
    const reads = await runtime.conversationReads();
    if (disposed || current !== generation) return;
    const unread = Object.entries(reads)
      .filter(([, read]) => read.unreadCount > 0)
      .map(([id]) => id);
    const writes = unread.map((id) => {
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
          });
        });
      readWrites.set(id, write);
      return write;
    });
    await Promise.all(writes);
  }
  createHostRestartToasts(() =>
    state.host
      ? [
          {
            id: state.host.hostId,
            name: state.host.name,
            online: state.status === "online",
            restart: state.hostRestart?.state ?? null,
            version: state.hostRestart?.version ?? null,
          },
        ]
      : [],
  );
  onSettled(() => {
    void refreshHosts().catch(report);
    const focus = () => {
      runtime.hosts?.refresh();
      void props
        .onSessionCheck()
        .then(() => refreshHosts())
        .then(() => refresh())
        .catch(report);
    };
    window.addEventListener("focus", focus);
    return () => {
      disposed = true;
      generation += 1;
      window.clearTimeout(wakeReconnectTimer);
      stopWaitingForInput?.();
      acceptedInvite = null;
      if (restartRetry) clearTimeout(restartRetry);
      window.removeEventListener("focus", focus);
      void runtime.dispose({ sessionsEnded: props.accountSessionEnded?.() ?? false }).catch(() => undefined);
    };
  });
  return {
    state,
    profiles,
    selected,
    conversation,
    runtime,
    preferences,
    orderedHosts,
    reorderHosts(hostIds: string[]) {
      setServerOrder(hostIds);
      writeWebServerOrder(props.accountId, hostIds);
    },
    /** Every event of the connected host. Returns the unsubscribe function. */
    onHostEvent(listener: (event: AgentEvent | TeamRealtimeEvent) => void) {
      hostEventListeners.add(listener);
      return () => {
        hostEventListeners.delete(listener);
      };
    },
    /** The events of the hosts this tab has not opened that a notification can show. Returns the unsubscribe function. */
    onHostNotice(listener: (hostId: string, event: WebHostNotice, agents: AgentSummary[]) => void) {
      hostNoticeListeners.add(listener);
      return () => {
        hostNoticeListeners.delete(listener);
      };
    },
    run,
    refreshHosts,
    retryHosts,
    reconnect,
    joinInvite,
    connect,
    select,
    refresh,
    send,
    cancelQueued: (deliveryId: string) => changeQueue((agentId) => runtime.cancelQueued({ agentId, deliveryId })),
    steerQueued(deliveryId: string) {
      const expectedTurnId = conversation()?.page?.activeTurnId;
      if (expectedTurnId) changeQueue((agentId) => runtime.steerQueued({ agentId, deliveryId, expectedTurnId }));
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
      // The edit belongs to the host that queued the message. This client talks only to the connected one.
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
    markAllRead,
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
    async deleteAgent(agentId: string): Promise<void> {
      if (state.status !== "online") throw new Error(currentText().t("webClient.error.deleteOffline"));
      if (state.host?.role === "member") throw new Error(currentText().t("error.team.membersCannotDeleteAgents"));
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
      setState((draft) => {
        draft.prompts = draft.prompts.filter((item) => String(item.requestId) !== String(input.requestId));
      });
      await refresh();
    },
    async respondToBrowserTakeover(decision: "complete" | "cancel") {
      const current = generation;
      const threadId = state.agents.find((agent) => agent.id === selectedId)?.threadId;
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
        if (current === generation) report(error);
        return false;
      }
    },
    activateBrowserTab(tabId: string) {
      if (state.browserTabs.some((tab) => tab.id === tabId))
        setState((draft) => {
          draft.activeBrowserTabId = tabId;
        });
    },
    async openSearchMessage(messageId: string) {
      const id = selectedId;
      const current = generation;
      if (!id) return;
      while (!state.conversations[id]?.page?.messages.some((message) => message.id === messageId)) {
        const page = state.conversations[id]?.page;
        if (!page?.pageInfo.hasOlder || !page.pageInfo.olderCursor) break;
        const cursor = page.pageInfo.olderCursor;
        await load(id, true);
        if (disposed || current !== generation || selectedId !== id) return;
        if (state.conversations[id]?.page?.pageInfo.olderCursor === cursor) break;
      }
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
    older: () => {
      const id = selectedId;
      return id ? run(() => load(id, true)) : Promise.resolve();
    },
    setDraft(text: string) {
      const id = selectedId;
      if (id)
        setState((draft) => {
          const conversation = draft.conversations[id];
          if (conversation) conversation.draft = text;
        });
    },
    acknowledgeSend() {
      const id = selectedId;
      if (id)
        setState((draft) => {
          const conversation = draft.conversations[id];
          if (!conversation) return;
          conversation.uncertain = false;
          conversation.sendError = null;
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
          // The agent was removed during the upload, so the host must not keep the file.
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
