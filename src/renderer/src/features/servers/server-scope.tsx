import { createRemoteConnectionRecovery, type RemoteRecoveryStatus } from "@openbot/team-client/remote-recovery";
import { createEffect, createSignal, createStore, flush, getOwner, isDisposed, onSettled, untrack } from "solid-js";
import { isGlobalSearchShortcut } from "../../global-search-shortcut";
import { useNavigation } from "../../navigation";
import { createSimpleContext } from "../../simple-context";
import { useAuth } from "../account/account-context";
import { useAgents } from "../agents/agents-context";
import { useBrowserTabs } from "../browser/browser-context";
import { useConversation } from "../conversation/conversation-context";
import { useDirectMessages } from "../conversation/direct-messages-context";
import { useSetup } from "../onboarding/onboarding-context";
import { useSidebar } from "../sidebar/sidebar-context";
import { usePresence } from "../team/team-context";
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
    const { pendingAgentSelection, setPendingAgentSelection } = useServerSwitch();
    const { setTeamPresence } = usePresence();
    const {
      activeDirectMemberId,
      directConversations,
      refreshDirectThreads,
      refreshDirectConversation,
      markDirectMessagesRead,
      conversationVisible,
    } = useDirectMessages();
    const { setModelOptions, activeAgent, setAgentStatus, applyStoredAgents } = useAgents();
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
      panelsFailed: boolean;
      panelsLoading: boolean;
      recovery: RemoteRecoveryStatus;
    }>({
      hasContent: false,
      loading: true,
      sequence: undefined,
      failed: false,
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
      () => {
        if (scopeIsCurrent())
          setConnection((draft) => {
            draft.failed = true;
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

    let loadGeneration = 0;
    async function loadWorkspace(): Promise<void> {
      const generation = ++loadGeneration;
      const isCurrent = () => scopeIsCurrent() && generation === loadGeneration;
      const serverId = activeServerId();
      const server = selectedServer();
      const sequence = server?.connectionSequence;
      if (!isCurrent() || !transportReady()) return;
      setConnection((draft) => {
        draft.failed = false;
        draft.loading = true;
      });
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
      void loadPanels();
      void serversPort()
        .servers.getPresence()
        .then((value) => {
          if (isCurrent()) setTeamPresence(value);
        })
        .catch(() => undefined);
      void refreshDirectThreads();
      void refreshDirectConversation();
    }

    async function loadPanels() {
      const generation = loadGeneration;
      const isCurrent = () => scopeIsCurrent() && generation === loadGeneration;
      const server = selectedServer();
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
            if (isCurrent()) setSidebarLayout(value);
          })
          .catch(failed),
      ];
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

    return { loaded, connection, retryPanels: loadPanels, retry: () => recovery.refresh() };
  },
});

export const ServerScopeProvider = ServerScope.provider;
export const useServerScope = ServerScope.use;
