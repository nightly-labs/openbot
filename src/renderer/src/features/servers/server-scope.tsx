import { AGENT_HIDDEN_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { createRemoteConnectionRecovery, type RemoteRecoveryStatus } from "@openbot/team-client/remote-recovery";
import { currentText } from "@openbot/ui/text";
import type { UserErrorDetails } from "@openbot/user-errors";
import { createEffect, createSignal, createStore, flush, getOwner, isDisposed, onSettled, untrack } from "solid-js";
import { isGlobalSearchShortcut } from "../../global-search-shortcut";
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
import { serverSupportsCapability } from "./server-capabilities";
import { useServerSwitch } from "./server-switch";
import { useServers } from "./servers-context";
import { serversPort } from "./servers-port";

/**
 * One mount per server. Everything below this provider is disposed and rebuilt
 * when the active server changes, which is what removed the twenty-setter
 * teardown `selectServer` used to run and the `resetForServer` slice every
 * per-server domain exported for it.
 *
 * First mount and server switches use the same required reads. Status, models
 * and agents must all succeed before the workspace is ready. Optional reads
 * do not block the workspace. Same-server recovery keeps loaded data.
 *
 * `loaded` replaces `dynamicIslandLoadedServerId`. The old flag had to name a
 * server because one global signal described whichever server was current; here
 * the scope *is* the server, so it is a boolean that starts false on every mount
 * and cannot describe the wrong one. `DynamicIslandBridge` reads it to avoid
 * publishing a half-loaded workspace to main.
 *
 * The two window listeners live here rather than in the global bootstrap because
 * both read scoped state: ⌘K needs the navigation domain, and focus needs the
 * open agent chat, its read state and the open direct conversation. They are
 * registered per mount, which is what the returned cleanup is for.
 */
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
    const { setModelOptions, activeAgent, setAgentStatus, applyStoredAgents, applyUserHiddenAgents } = useAgents();
    const {
      setBrowserControlState,
      supportsBrowser,
      loadDisplayState: loadBrowserDisplayState,
      loadControlState: loadBrowserControlState,
      beginBrowserLoad,
    } = useBrowserTabs();
    const { setSidebarLayout, loadLayout: loadSidebarLayout, reconcileActiveServerPins } = useSidebar();
    const { globalSearchOpen, setGlobalSearchVisibility, selectAgent } = useNavigation();
    const { conversations, clearRecentReplies, requestConversationRead, applyConversationReads, isAgentChatOpen } =
      useConversation();

    const [bootstrapReady, setBootstrapReady] = createSignal(false);
    const [connection, setConnection] = createStore<{
      hasContent: boolean;
      loading: boolean;
      sequence: number | undefined;
      failed: boolean;
      /** Why the last load failed, for the connection notice. Null when `failed` is false. */
      failure: UserErrorDetails | null;
      panelsFailed: boolean;
      panelsLoading: boolean;
      recovery: RemoteRecoveryStatus;
    }>({
      hasContent: false,
      loading: true,
      sequence: undefined,
      failed: false,
      failure: null,
      panelsFailed: false,
      panelsLoading: false,
      recovery: { phase: "connecting", attempt: 0, remainingSeconds: 0 },
    });
    const selectedServer = () => servers().find((candidate) => candidate.id === activeServerId());
    const transportReady = () => selectedServer()?.kind !== "remote" || selectedServer()?.state === "online";
    const loaded = () =>
      connection.hasContent &&
      !connection.loading &&
      connection.sequence === selectedServer()?.connectionSequence &&
      connection.recovery.phase === "online" &&
      transportReady();
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
    /** This scope still owns the screen - the successor to `activeServerId() !== serverId`. */
    const scopeIsCurrent = (): boolean => !(owner && isDisposed(owner));

    const signedInAccount = () => {
      const auth = centralAuth();
      return auth.status === "signed_in" ? auth.user.id : null;
    };
    /** The account signed in when the last load started. Undefined until a load starts. */
    let loadedAccount: string | null | undefined;

    let loadGeneration = 0;
    async function loadWorkspace(): Promise<void> {
      const generation = ++loadGeneration;
      const serverId = activeServerId();
      const server = selectedServer();
      const sequence = server?.connectionSequence;
      const isCurrent = () =>
        scopeIsCurrent() && generation === loadGeneration && sequence === selectedServer()?.connectionSequence;
      if (!isCurrent() || !transportReady()) return;
      loadedAccount = untrack(signedInAccount);
      setConnection((draft) => {
        draft.failed = false;
        draft.failure = null;
        draft.loading = true;
      });
      // The panels do not wait for the agents: a starting host answers its layout at once but holds the
      // agent list until its agents load, and agents shown before their sections show ungrouped.
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
      // By id: a chat window can show a server that the main window does not.
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
      const reads = [
        loadSidebarLayout(server)
          .then((value) => {
            // A layout event can land while this read is in flight. The newer revision stays.
            if (value && isCurrent())
              setSidebarLayout((current) => (value.revision >= current.revision ? value : current));
          })
          .catch(failed),
      ];
      // A joined server without `agent-hidden-v1` has no hidden agents.
      if (server && serverSupportsCapability(server, AGENT_HIDDEN_CAPABILITY)) {
        reads.push(
          serversPort()
            .agent.listHiddenAgents(server.id)
            .then((value) => {
              if (isCurrent()) applyUserHiddenAgents(value.agents);
            })
            .catch(failed),
        );
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
          !isGlobalSearchShortcut(event) ||
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
      // `Platform` owns the flag and registers its own listener first, so
      // `appFocused()` already reads true by the time this one runs.
      const handleWindowFocus = () => {
        flush(() => {
          clearRecentReplies();
          const agentId = activeAgent()?.id;
          if (agentId && isAgentChatOpen(agentId) && (conversations[agentId]?.read?.unreadCount ?? 0) > 0) {
            requestConversationRead(agentId);
          }
          // `conversationVisible` rather than the bare focus this listener runs on: the
          // agent branch above asks the same question through `isAgentChatOpen`, and a
          // direct message the Usage report covers was no more seen than an agent reply.
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
      () => serverLoadRequest(),
      (request) =>
        untrack(() => {
          if (request?.serverId === activeServerId()) recovery.refresh();
        }),
    );

    // Read states and direct threads belong to the signed-in reader. At a cold start the saved account
    // can restore after the first load, which then had no reader, so a sign-in, or another account,
    // loads the workspace again.
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

    // "Select this agent once you are on its server" - written before the switch
    // by the marketplace and the Dynamic Island, consumed by whichever scope the
    // switch lands in. It is taken rather than read so a later mount cannot
    // replay it.
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

    return { loaded, connection, retryPanels: loadPanels, retry: () => recovery.refresh() };
  },
});

export const ServerScopeProvider = ServerScope.provider;
export const useServerScope = ServerScope.use;
