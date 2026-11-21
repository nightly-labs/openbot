import type { ChannelSummary } from "@openbot/contracts/ipc";
import { AGENT_NOTIFICATION_LEVELS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-notification-levels-v1";
import { AGENT_HIDDEN_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { SIDEBAR_PINS_CAPABILITY } from "@openbot/contracts/team-protocol/sidebar-pins-v1";
import { createRemoteConnectionRecovery, type RemoteRecoveryStatus } from "@openbot/team-client/remote-recovery";
import { markRemoteSync } from "@openbot/team-client/sync-profile";
import { currentText } from "@openbot/ui/text";
import type { UserErrorDetails } from "@openbot/user-errors";
import {
  createEffect,
  createMemo,
  createSignal,
  createStore,
  flush,
  getOwner,
  isDisposed,
  onSettled,
  untrack,
} from "solid-js";
import { matchesShortcut } from "../../keyboard-shortcut-preference";
import { useNavigation } from "../../navigation";
import { createSimpleContext } from "../../simple-context";
import { useAuth } from "../account/account-context";
import { useAgentThreads } from "../agent-threads/agent-threads-context";
import { useAgents } from "../agents/agents-context";
import { useBrowserTabs } from "../browser/browser-context";
import { useChannels } from "../channels/channels-context";
import { useConversation } from "../conversation/conversation-context";
import { useDirectMessages } from "../conversation/direct-messages-context";
import { useSetup } from "../onboarding/onboarding-context";
import { useSidebar } from "../sidebar/sidebar-context";
import { usePresence } from "../team/team-context";
import { deleteCachedWorkflows, keepCachedWorkflows } from "../workflows/workflow-cache";
import {
  deleteRemoteWorkspaceFrame,
  deleteRemoteWorkspaceFrames,
  readRemoteWorkspaceFrame,
  saveRemoteWorkspaceFrame,
} from "./remote-workspace-frame";
import { serverSupportsCapability } from "./server-capabilities";
import { useServerSwitch } from "./server-switch";
import { useServers } from "./servers-context";
import { serversPort } from "./servers-port";

const ServerScope = createSimpleContext({
  name: "Server scope",
  init: () => {
    const { centralAuth } = useAuth();
    const { setupState } = useSetup();
    const { servers, activeServerId, initialServersReady, serverLoadRequest, serversLoaded } = useServers();
    const {
      pendingAgentSelection,
      setPendingAgentSelection,
      pendingChannelSelection,
      setPendingChannelSelection,
      pendingThreadSelection,
      setPendingThreadSelection,
    } = useServerSwitch();
    const agentThreads = useAgentThreads();
    const channels = useChannels();
    const { setTeamPresence } = usePresence();
    const {
      activeDirectMemberId,
      directConversations,
      refreshDirectThreads,
      refreshDirectConversation,
      markDirectMessagesRead,
      conversationVisible,
    } = useDirectMessages();
    const {
      setModelOptions,
      activeAgent,
      setAgentStatus,
      applyStoredAgents,
      applyFrameAgents,
      applyUserHiddenAgents,
      applyOwnAgentLevels,
      ownAgentLevelsApplied,
      userHiddenAgents,
    } = useAgents();
    const {
      setBrowserControlState,
      supportsBrowser,
      loadDisplayState: loadBrowserDisplayState,
      loadControlState: loadBrowserControlState,
      beginBrowserLoad,
    } = useBrowserTabs();
    const {
      sidebarLayout,
      setSidebarLayout,
      loadLayout: loadSidebarLayout,
      reconcileActiveServerPins,
      syncActiveServerPins,
    } = useSidebar();
    const { globalSearchOpen, setGlobalSearchVisibility, selectAgent } = useNavigation();
    const { conversations, clearRecentReplies, requestConversationRead, applyConversationReads, isAgentChatOpen } =
      useConversation();

    const [bootstrapReady, setBootstrapReady] = createSignal(false);
    const [frameChannels, setFrameChannels] = createSignal<ChannelSummary[]>([]);
    const [connection, setConnection] = createStore<{
      hasContent: boolean;
      synced: boolean;
      loading: boolean;
      sequence: number | undefined;
      failed: boolean;
      failure: UserErrorDetails | null;
      panelsFailed: boolean;
      panelsLoading: boolean;
      recovery: RemoteRecoveryStatus;
    }>({
      hasContent: false,
      synced: false,
      loading: true,
      sequence: undefined,
      failed: false,
      failure: null,
      panelsFailed: false,
      panelsLoading: false,
      recovery: { phase: "connecting", attempt: 0, remainingSeconds: 0 },
    });
    const selectedServer = () => servers().find((candidate) => candidate.id === activeServerId());
    const transportReady = () => {
      const server = selectedServer();
      if (server?.kind !== "remote") return true;
      return server.state === "online" && centralAuth().status !== "loading" && !server.capabilitiesPending;
    };
    const loaded = () =>
      connection.hasContent &&
      !connection.loading &&
      connection.sequence === selectedServer()?.connectionSequence &&
      connection.recovery.phase === "online" &&
      transportReady();
    createEffect(loaded, (ready) => {
      if (ready)
        setConnection((draft) => {
          draft.synced = true;
        });
    });
    const recovery = createRemoteConnectionRecovery(
      loadWorkspace,
      (error) => {
        if (!scopeIsCurrent()) return;
        const text = currentText();
        const failure = text.errorDetails(error, text.t("server.connection.failedDescription"));
        setConnection((draft) => {
          draft.failed = true;
          draft.failure = failure;
          draft.loading = false;
        });
      },
      (status) => {
        if (scopeIsCurrent())
          setConnection((draft) => {
            draft.recovery = status;
          });
      },
    );
    const owner = getOwner();
    const scopeIsCurrent = (): boolean => !(owner && isDisposed(owner));

    const signedInAccount = () => {
      const auth = centralAuth();
      return auth.status === "signed_in" ? auth.user.id : null;
    };
    let loadedAccount: string | null | undefined;

    let loadGeneration = 0;
    let loadingSequence: number | undefined;
    async function loadWorkspace(): Promise<void> {
      loadingSequence = undefined;
      try {
        await readWorkspace((sequence) => {
          loadingSequence = sequence;
        });
      } finally {
        loadingSequence = undefined;
      }
    }

    async function readWorkspace(started: (sequence: number | undefined) => void): Promise<void> {
      const generation = ++loadGeneration;
      const serverId = activeServerId();
      const server = selectedServer();
      const sequence = server?.connectionSequence;
      const isCurrent = () =>
        scopeIsCurrent() && generation === loadGeneration && sequence === selectedServer()?.connectionSequence;
      if (!isCurrent() || !transportReady()) return;
      if (server?.kind === "remote" && server.compatibility?.hostAppVersion) started(sequence);
      if (server?.kind === "remote") markRemoteSync("workspace-load");
      loadedAccount = untrack(signedInAccount);
      setConnection((draft) => {
        draft.failed = false;
        draft.failure = null;
        draft.loading = true;
      });
      void loadPanels();
      const [status, models, agents, reads] = await Promise.all([
        serversPort().agent.getStatus(serverId),
        serversPort().agent.listModels(serverId),
        serversPort().agent.listAgents(serverId),
        serversPort()
          .agent.listConversationReads(serverId)
          .catch(() => null),
      ]);
      if (!isCurrent()) return;
      setAgentStatus(status);
      setModelOptions(models);
      if (reads) applyConversationReads(reads);
      applyStoredAgents(agents);
      reconcileActiveServerPins(agents.map((agent) => agent.id));
      setConnection((draft) => {
        draft.hasContent = true;
        draft.loading = false;
        draft.sequence = sequence;
      });
      if (server?.kind === "remote" && loadedAccount)
        saveRemoteWorkspaceFrame(loadedAccount, serverId, { agents, models });
      void serversPort()
        .servers.getPresenceFor(serverId)
        .then((value) => {
          if (isCurrent()) setTeamPresence(value);
        })
        .catch(() => undefined);
      void refreshDirectThreads();
      void refreshDirectConversation();
    }

    async function loadPanels() {
      const generation = loadGeneration;
      const server = selectedServer();
      const sequence = server?.connectionSequence;
      const isCurrent = () =>
        scopeIsCurrent() && generation === loadGeneration && sequence === selectedServer()?.connectionSequence;
      setConnection((draft) => {
        draft.panelsFailed = false;
        draft.panelsLoading = true;
      });
      const failed = () => {
        if (isCurrent())
          setConnection((draft) => {
            draft.panelsFailed = true;
          });
      };
      const account = server?.kind === "remote" ? untrack(signedInAccount) : null;
      const reads = [
        loadSidebarLayout(server)
          .then((value) => {
            if (value && isCurrent()) {
              setSidebarLayout((current) => (value.revision >= current.revision ? value : current));
              if (account && server) saveRemoteWorkspaceFrame(account, server.id, { sidebarLayout: value });
            }
          })
          .catch(failed),
      ];
      if (server && serverSupportsCapability(server, SIDEBAR_PINS_CAPABILITY))
        void syncActiveServerPins().catch(() => undefined);
      if (server && serverSupportsCapability(server, AGENT_HIDDEN_CAPABILITY)) {
        reads.push(
          serversPort()
            .agent.listHiddenAgents(server.id)
            .then((value) => {
              if (!isCurrent()) return;
              applyUserHiddenAgents(value.agents);
              if (account) saveRemoteWorkspaceFrame(account, server.id, { hiddenAgents: value.agents });
            })
            .catch(failed),
        );
      }
      if (server && serverSupportsCapability(server, AGENT_NOTIFICATION_LEVELS_CAPABILITY)) {
        const appliedBefore = ownAgentLevelsApplied();
        void serversPort()
          .agent.listAgentNotificationLevels(server.id)
          .then((value) => {
            if (isCurrent() && ownAgentLevelsApplied() === appliedBefore) applyOwnAgentLevels(value);
          })
          .catch(() => undefined);
      }
      if (supportsBrowser(server)) {
        const applyDisplayState = beginBrowserLoad();
        reads.push(
          loadBrowserDisplayState(server)
            .then((value) => {
              if (isCurrent()) applyDisplayState(value);
            })
            .catch(failed),
        );
        reads.push(
          loadBrowserControlState(server)
            .then((value) => {
              if (isCurrent()) setBrowserControlState(value);
            })
            .catch(failed),
        );
      }
      await Promise.all(reads);
      if (isCurrent())
        setConnection((draft) => {
          draft.panelsLoading = false;
        });
    }

    onSettled(() => {
      const handleGlobalSearchShortcut = (event: KeyboardEvent) => {
        if (
          !matchesShortcut(event, "globalSearch") ||
          centralAuth().status !== "signed_in" ||
          setupState()?.completed !== true
        ) {
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        setGlobalSearchVisibility(!globalSearchOpen());
      };
      window.addEventListener("keydown", handleGlobalSearchShortcut);
      const handleWindowFocus = () => {
        flush(() => {
          clearRecentReplies();
          const agentId = activeAgent()?.id;
          if (agentId && isAgentChatOpen(agentId) && (conversations[agentId]?.read?.unreadCount ?? 0) > 0) {
            requestConversationRead(agentId);
          }
          const memberId = activeDirectMemberId();
          if (memberId && conversationVisible() && (directConversations()[memberId]?.readState?.unreadCount ?? 0) > 0) {
            void markDirectMessagesRead(memberId).catch(() => undefined);
          }
        });
      };
      window.addEventListener("focus", handleWindowFocus);

      void initialServersReady.then(() => {
        if (scopeIsCurrent()) setBootstrapReady(true);
      });

      return () => {
        loadGeneration += 1;
        recovery.dispose();
        window.removeEventListener("keydown", handleGlobalSearchShortcut);
        window.removeEventListener("focus", handleWindowFocus);
      };
    });

    createEffect(
      createMemo(() => {
        const server = selectedServer();
        const account = signedInAccount();
        return server?.kind === "remote" && account && serversLoaded() && setupState()?.completed === true
          ? `${account}\0${server.id}`
          : null;
      }),
      (key) =>
        untrack(() => {
          if (!key || connection.hasContent) return;
          const [account = "", serverId = ""] = key.split("\0");
          const frame = readRemoteWorkspaceFrame(account, serverId);
          if (!frame?.agents.length) return;
          setModelOptions(frame.models);
          applyFrameAgents(frame.agents);
          applyUserHiddenAgents(frame.hiddenAgents);
          setFrameChannels(frame.channels);
          const layout = frame.sidebarLayout;
          if (layout) setSidebarLayout((current) => (layout.revision >= current.revision ? layout : current));
          setConnection((draft) => {
            draft.hasContent = true;
          });
          markRemoteSync("workspace-frame");
        }),
    );

    createEffect(
      () => {
        const server = selectedServer();
        const account = signedInAccount();
        return server?.kind === "remote" && account && loaded() && !connection.panelsLoading && !connection.panelsFailed
          ? { account, serverId: server.id, sidebarLayout: sidebarLayout(), hiddenAgents: userHiddenAgents() }
          : null;
      },
      (frame) => {
        if (frame)
          saveRemoteWorkspaceFrame(frame.account, frame.serverId, {
            sidebarLayout: frame.sidebarLayout,
            hiddenAgents: frame.hiddenAgents,
          });
      },
    );

    createEffect(
      () => centralAuth().status === "signed_out",
      (signedOut) => {
        if (!signedOut) return;
        deleteRemoteWorkspaceFrames(null);
        keepCachedWorkflows(null);
      },
    );
    createEffect(
      createMemo(() => {
        const account = signedInAccount();
        if (!account || !serversLoaded()) return null;
        return [account, ...servers().flatMap((server) => (server.kind === "remote" ? [server.id] : []))].join("\0");
      }),
      (key) => {
        if (!key) return;
        const [account = "", ...serverIds] = key.split("\0");
        deleteRemoteWorkspaceFrames(account, serverIds);
        keepCachedWorkflows(account, serverIds);
      },
    );
    createEffect(
      createMemo(() => {
        const server = selectedServer();
        const account = signedInAccount();
        return account && server?.kind === "remote" && server.issue?.code === "authentication_required"
          ? `${account}\0${server.id}`
          : null;
      }),
      (key) => {
        if (!key) return;
        const [account = "", serverId = ""] = key.split("\0");
        deleteRemoteWorkspaceFrame(account, serverId);
        deleteCachedWorkflows(serverId);
      },
    );

    createEffect(
      () => serverLoadRequest(),
      (request) =>
        untrack(() => {
          if (request?.serverId !== activeServerId()) return;
          if (request.connectionSequence !== undefined && request.connectionSequence === loadingSequence) return;
          recovery.refresh();
        }),
    );

    createEffect(signedInAccount, (account) =>
      untrack(() => {
        if (account && loadedAccount !== undefined && account !== loadedAccount) recovery.refresh();
      }),
    );

    createEffect(
      () => ({ ready: bootstrapReady() && serversLoaded() && transportReady(), id: activeServerId() }),
      ({ ready }) => {
        if (!ready) loadGeneration += 1;
        recovery.setActive(ready);
      },
    );

    createEffect(
      () => pendingAgentSelection(),
      (agentId) => {
        if (!agentId) return;
        setPendingAgentSelection(null);
        selectAgent(agentId);
      },
    );
    createEffect(
      () => pendingThreadSelection(),
      (selection) => {
        if (!selection) return;
        setPendingThreadSelection(null);
        void agentThreads.openConversation(selection.agentId, selection.threadId);
      },
    );
    createEffect(
      () => pendingChannelSelection(),
      (channelId) => {
        if (!channelId) return;
        setPendingChannelSelection(null);
        void channels.open(channelId);
      },
    );

    return { loaded, connection, frameChannels, retryPanels: loadPanels, retry: () => recovery.refresh() };
  },
});

export const ServerScopeProvider = ServerScope.provider;
export const useServerScope = ServerScope.use;
