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
  RespondToApprovalInput,
  RespondToPromptInput,
  SidebarLayoutAction,
  SidebarLayoutSnapshot,
  TeamPresenceSnapshot,
} from "@openbot/contracts/ipc";
import type { RemoteTeamHost } from "@openbot/team-client/remote-directory";
import { reconcilePendingRequests } from "@openbot/team-client/runtime-attention";
import type { SidebarPinnedItem } from "@openbot/ui/features/sidebar/sidebar-pins";
import { createMemo, createStore, onSettled } from "solid-js";
import { toAgentProfile } from "../../app-message-projection";
import { mergeConversationPage } from "../conversation/conversation-merge";
import { defaultSidebarLayout } from "../sidebar/sidebar-sections";
import { createWebWorkspaceRuntime, type WebRuntimeEvents, type WebWorkspaceRuntime } from "./web-runtime";

interface WebConversation {
  page: ConversationPage | null;
  draft: string;
  attachments: AttachmentSummary[];
  loading: boolean;
  sending: boolean;
  uncertain: boolean;
}
interface WebWorkspaceState {
  hosts: RemoteTeamHost[];
  host: RemoteTeamHost | null;
  agents: AgentSummary[];
  selectedId: string | null;
  conversations: Record<string, WebConversation>;
  approvals: Array<AgentApproval | AgentRuntimeApproval>;
  prompts: Array<Extract<AgentEvent, { type: "prompt" }>>;
  takeovers: BrowserTakeoverRequest[];
  browserTabs: BrowserTab[];
  activeBrowserTabId: string | null;
  browserControlState: BrowserControlState;
  /** Who is on the connected host. Null until the host answers. */
  presence: TeamPresenceSnapshot | null;
  capabilities: string[];
  status: "connecting" | "online" | "offline";
  hostsLoaded: boolean;
  hostsLoading: boolean;
  hostsError: string | null;
  revocationRevision: number;
  error: string | null;
  busy: boolean;
  uploading: boolean;
  hiddenIds: string[];
  pinnedIds: string[];
  duplicatingAgentIds: string[];
  sidebarLayout: SidebarLayoutSnapshot;
  sidebarCollapsedSectionIds: string[];
}
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
    selectedId: null,
    conversations: {},
    approvals: [],
    prompts: [],
    takeovers: [],
    browserTabs: [],
    activeBrowserTabId: null,
    browserControlState: { sessions: [] },
    presence: null,
    capabilities: [],
    status: "offline",
    hostsLoaded: false,
    hostsLoading: false,
    hostsError: null,
    revocationRevision: 0,
    error: null,
    busy: false,
    uploading: false,
    hiddenIds: [],
    pinnedIds: [],
    duplicatingAgentIds: [],
    sidebarLayout: defaultSidebarLayout(),
    sidebarCollapsedSectionIds: [],
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
  const runtime = (props.createRuntime ?? createWebWorkspaceRuntime)(
    props.accountId,
    {
      accountChanged: props.onSessionCheck,
      connection(update) {
        if (disposed || update.hostId !== hostId) return;
        setState((draft) => {
          draft.status = update.state;
          draft.error = update.message;
          if (update.state !== "online") {
            draft.approvals = [];
            draft.prompts = [];
            draft.takeovers = [];
            draft.browserTabs = [];
            draft.activeBrowserTabId = null;
            draft.browserControlState = { sessions: [] };
            draft.sidebarLayout = defaultSidebarLayout();
            draft.sidebarCollapsedSectionIds = [];
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
            draft.conversations = {};
            draft.selectedId = null;
            draft.approvals = [];
            draft.prompts = [];
            draft.takeovers = [];
            draft.browserTabs = [];
            draft.activeBrowserTabId = null;
            draft.browserControlState = { sessions: [] };
            draft.sidebarLayout = defaultSidebarLayout();
            draft.sidebarCollapsedSectionIds = [];
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
        if (update.state === "online") revokedReconnect = false;
        if (update.state === "online" && update.resync) void resync();
      },
      event(id, event) {
        if (disposed || id !== hostId) return;
        if (event.type === "team-presence")
          setState((draft) => {
            draft.presence = event.snapshot;
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
        } else if (event.type === "turn-completed") {
          setState((draft) => {
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
        if (event.type === "agents-changed") reconcileAgents(event.agents);
        if (event.type === "sidebar-layout-changed")
          setState((draft) => {
            if (event.layout.revision >= draft.sidebarLayout.revision) draft.sidebarLayout = event.layout;
          });
        if (
          [
            "conversation",
            "conversation-page",
            "conversation-invalidated",
            "conversation-delta",
            "turn-started",
            "turn-completed",
            "prompt",
            "agent-input-resolved",
          ].includes(event.type)
        )
          void refresh();
        if (event.type === "error")
          setState((draft) => {
            draft.error = "The host reported an error. Check the conversation and host status.";
          });
      },
    },
    props.accountFetch,
  );
  const profiles = createMemo(() => state.agents.map(toAgentProfile));
  const selected = createMemo(() => profiles().find((agent) => agent.id === state.selectedId));
  const conversation = createMemo(() => (state.selectedId ? state.conversations[state.selectedId] : undefined));

  function report(error: unknown) {
    if (!disposed)
      setState((draft) => {
        draft.error = error instanceof Error ? error.message : "The request failed.";
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
      draft.hiddenIds = draft.hiddenIds.filter((id) => ids.has(id));
      draft.pinnedIds = draft.pinnedIds.filter((id) => ids.has(id));
      draft.duplicatingAgentIds = draft.duplicatingAgentIds.filter((id) => ids.has(id));
      for (const id of removed) delete draft.conversations[id];
      if (nextSelected === null) draft.selectedId = null;
      draft.sidebarLayout = {
        ...draft.sidebarLayout,
        agentOrder: draft.sidebarLayout.agentOrder.filter((id) => ids.has(id)),
        agentAssignments: Object.fromEntries(
          Object.entries(draft.sidebarLayout.agentAssignments).filter(([id]) => ids.has(id)),
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
            draft.selectedId = null;
            draft.agents = [];
            draft.conversations = {};
            draft.approvals = [];
            draft.prompts = [];
            draft.takeovers = [];
            draft.browserTabs = [];
            draft.activeBrowserTabId = null;
            draft.browserControlState = { sessions: [] };
            draft.sidebarLayout = defaultSidebarLayout();
            draft.sidebarCollapsedSectionIds = [];
            draft.duplicatingAgentIds = [];
            draft.capabilities = [];
            draft.status = "offline";
            draft.error = "Access to this host has ended.";
          });
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
        if (!hostId && hosts[0]) await connect(hosts[0]);
      } catch (error) {
        if (!disposed) {
          const message = error instanceof Error ? error.message : "Could not load your hosts.";
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
  async function reconnect(): Promise<void> {
    const host = state.hosts.find((listed) => listed.hostId === state.host?.hostId) ?? state.host;
    if (!host || state.status === "connecting") return;
    await connect({ ...host });
  }
  async function joinInvite(inviteUrl: string): Promise<void> {
    const normalizedInviteUrl = inviteUrl.trim();
    if (!normalizedInviteUrl) throw new Error("Enter an invitation link.");
    const cached = acceptedInvite?.inviteUrl === normalizedInviteUrl ? acceptedInvite : null;
    const host = cached?.host ?? (await runtime.acceptInvite(normalizedInviteUrl));
    acceptedInvite = { inviteUrl: normalizedInviteUrl, host };
    const hadHostSelection = hostId !== null;
    await refreshHosts();
    if (state.host?.hostId !== host.hostId || (state.status !== "online" && hadHostSelection)) await connect(host);
    if (state.status !== "online" || state.host?.hostId !== host.hostId)
      throw new Error("The invitation was accepted, but the host is offline. Try again.");
    acceptedInvite = null;
  }
  async function connect(host: RemoteTeamHost) {
    if (state.status === "connecting") return;
    const current = ++generation;
    const sameHost = hostId === host.hostId;
    const previousSelected = sameHost ? selectedId : null;
    hostId = host.hostId;
    selectedId = null;
    setState((draft) => {
      draft.host = host;
      draft.status = "connecting";
      draft.agents = [];
      draft.selectedId = null;
      if (!sameHost) {
        draft.conversations = {};
        draft.hiddenIds = [];
        draft.pinnedIds = [];
        draft.sidebarCollapsedSectionIds = [];
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
      draft.takeovers = [];
      draft.browserTabs = [];
      draft.activeBrowserTabId = null;
      draft.browserControlState = { sessions: [] };
      draft.sidebarLayout = defaultSidebarLayout();
      draft.duplicatingAgentIds = [];
      draft.capabilities = [];
      draft.presence = null;
      draft.error = null;
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
      setState((draft) => {
        draft.capabilities = capabilities;
        draft.agents = agents;
        draft.status = "online";
        draft.browserTabs = browserTabs;
        draft.activeBrowserTabId = browserTabs[0]?.id ?? null;
        if (sidebarLayout.revision >= draft.sidebarLayout.revision) draft.sidebarLayout = sidebarLayout;
      });
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
      });
      report(error);
    }
  }
  async function load(id: string, older = false) {
    const current = generation;
    const previous = state.conversations[id];
    const before = older ? (previous?.page?.pageInfo.olderCursor ?? undefined) : undefined;
    if (older && !before) return;
    const page = await runtime.conversation(id, before);
    if (disposed || current !== generation) return;
    if (page.agentId !== id) throw new Error("The host returned another conversation.");
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
          prompt.agentId !== id || prompt.threadId !== page.threadId || !resolvedRequests.has(String(prompt.requestId)),
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
      };
      item.loading = false;
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
      report(new Error("The message is too long."));
      return false;
    }
    setState((draft) => {
      const conversation = draft.conversations[id];
      if (conversation) conversation.sending = true;
      draft.error = null;
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
        if (conversation) conversation.uncertain = true;
        draft.error = "Message delivery is not confirmed. Refresh and check the conversation before sending again.";
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
  onSettled(() => {
    void refreshHosts().catch(report);
    const focus = () => {
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
      acceptedInvite = null;
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
    run,
    refreshHosts,
    retryHosts,
    reconnect,
    joinInvite,
    connect,
    select,
    refresh,
    send,
    async mutateSidebarLayout(action: SidebarLayoutAction) {
      if (state.status !== "online" || !state.capabilities.includes("sidebar-layout")) {
        throw new Error("This host does not support sidebar layout changes.");
      }
      const mutate = runtime.mutateSidebarLayout;
      if (!mutate) throw new Error("This host does not support sidebar layout changes.");
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
      if (state.status !== "online") throw new Error("Connect to your host before deleting an agent.");
      if (state.host?.role === "member") throw new Error("Members cannot delete agents.");
      if (!state.agents.some((agent) => agent.id === agentId)) return;
      const current = generation;
      const wasSelected = selectedId === agentId;
      try {
        await runtime.deleteAgent(agentId);
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
    toggleSidebarSection(sectionId: string) {
      setState((draft) => {
        const sections = new Set(draft.sidebarCollapsedSectionIds);
        if (sections.has(sectionId)) sections.delete(sectionId);
        else sections.add(sectionId);
        draft.sidebarCollapsedSectionIds = [...sections];
      });
    },
    reorderPinnedSidebarItems(items: SidebarPinnedItem[]) {
      const seen = new Set<string>();
      setState((draft) => {
        draft.pinnedIds = items.flatMap((item) => {
          if (item.kind !== "agent" || seen.has(item.id)) return [];
          seen.add(item.id);
          return [item.id];
        });
      });
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
          if (conversation) conversation.uncertain = false;
        });
    },
    async upload(file: File) {
      const id = selectedId;
      if (!id) return;
      if ((state.conversations[id]?.attachments.length ?? 0) >= INPUT_LIMITS.attachments) {
        report(new Error(`A message can have up to ${INPUT_LIMITS.attachments} attachments.`));
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
        draft.pinnedIds = draft.pinnedIds.filter((value) => value !== id);
      });
    },
    togglePinned(id: string) {
      setState((draft) => {
        draft.pinnedIds = draft.pinnedIds.includes(id)
          ? draft.pinnedIds.filter((value) => value !== id)
          : [...draft.pinnedIds, id];
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
