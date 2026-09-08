import { createEffect, createSignal, flush, getOwner, isDisposed, onSettled } from "solid-js";
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

/**
 * One mount per server. Everything below this provider is disposed and rebuilt
 * when the active server changes, which is what removed the twenty-setter
 * teardown `selectServer` used to run and the `resetForServer` slice every
 * per-server domain exported for it.
 *
 * It also collapses the load that existed twice. The startup bootstrap and
 * `selectServer` ran the same per-server sequence behind the same
 * incompatible-remote cutoff, and had already drifted - a `catch` per promise in
 * one, a single `Promise.all` without one in the other, and a different subset of
 * loads - which is the "works at startup, not after a switch" class of bug in the
 * shape it actually takes. First mount and server switch are now the same mount,
 * so the sequence exists once. The shape kept is the bootstrap's: a `catch` per
 * load, so one failure cannot take the other seven with it.
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
    const { servers, activeServerId, initialServersReady, serverLoadRequest } = useServers();
    const { pendingAgentSelection, setPendingAgentSelection } = useServerSwitch();
    const { setTeamPresence } = usePresence();
    const { activeDirectMemberId, directConversations, refreshDirectThreads, markDirectMessagesRead } =
      useDirectMessages();
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

    const [loaded, setLoaded] = createSignal(false);
    const owner = getOwner();
    /** This scope still owns the screen - the successor to `activeServerId() !== serverId`. */
    const scopeIsCurrent = (): boolean => !(owner && isDisposed(owner));

    let loadGeneration = 0;
    function loadWorkspace(): void {
      const generation = ++loadGeneration;
      const isCurrent = () => scopeIsCurrent() && generation === loadGeneration;
      if (!isCurrent()) return;
      const serverId = activeServerId();
      const server = servers().find((candidate) => candidate.id === serverId);
      if (server?.kind === "remote" && (server.state === "incompatible" || server.issue != null)) {
        return;
      }
      void Promise.all([
        window.openbot.agent
          .getStatus()
          .then((value) => {
            if (isCurrent()) setAgentStatus(value);
          })
          .catch(() => undefined),
        window.openbot.agent
          .listModels()
          .then((value) => {
            if (isCurrent()) setModelOptions(value);
          })
          .catch(() => undefined),
        window.openbot.agent
          .listAgents()
          .then((storedAgents) => {
            if (!isCurrent()) return;
            applyStoredAgents(storedAgents);
            reconcileActiveServerPins(storedAgents.map((agent) => agent.id));
          })
          .catch((error) => {
            if (!isCurrent()) return;
            setAgentStatus((current) => ({ ...current, message: String(error) }));
          }),
        loadSidebarLayout(server)
          .then((value) => {
            if (isCurrent()) setSidebarLayout(value);
          })
          .catch(() => undefined),
        window.openbot.agent
          .listConversationReads()
          .then((value) => {
            if (isCurrent()) applyConversationReads(value);
          })
          .catch(() => undefined),
      ]).finally(() => {
        if (isCurrent()) setLoaded(true);
      });
      if (supportsBrowser(server)) {
        const applyDisplayState = beginBrowserLoad();
        void loadBrowserDisplayState(server)
          .then((value) => {
            if (isCurrent()) applyDisplayState(value);
          })
          .catch(() => undefined);
        void loadBrowserControlState(server)
          .then((value) => {
            if (isCurrent()) setBrowserControlState(value);
          })
          .catch(() => undefined);
      }
      void window.openbot.servers
        .getPresence()
        .then((value) => {
          if (isCurrent()) setTeamPresence(value);
        })
        .catch(() => undefined);
      void refreshDirectThreads();
    }

    onSettled(() => {
      const handleGlobalSearchShortcut = (event: KeyboardEvent) => {
        if (
          event.key.toLocaleLowerCase() !== "k" ||
          (!event.metaKey && !event.ctrlKey) ||
          event.altKey ||
          event.shiftKey ||
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
          const memberId = activeDirectMemberId();
          if (memberId && (directConversations()[memberId]?.readState?.unreadCount ?? 0) > 0) {
            void markDirectMessagesRead(memberId).catch(() => undefined);
          }
        });
      };
      window.addEventListener("focus", handleWindowFocus);

      void initialServersReady.then(loadWorkspace);

      return () => {
        window.removeEventListener("keydown", handleGlobalSearchShortcut);
        window.removeEventListener("focus", handleWindowFocus);
      };
    });

    createEffect(
      () => serverLoadRequest(),
      (request) => {
        if (request?.serverId === activeServerId()) loadWorkspace();
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

    return { loaded };
  },
});

export const ServerScopeProvider = ServerScope.provider;
export const useServerScope = ServerScope.use;
