import {
  type ConversationMessage,
  type ConversationReadState,
  REMOTE_WORKSPACE_CACHE_LIMITS,
  type RemoteWorkspaceCache,
  type SaveRemoteWorkspaceInput,
  type SidebarLayoutSnapshot,
} from "@openbot/contracts/ipc";
import type { AgentMessage, AgentProfile } from "@openbot/ui/data";
import { computeSidebarAgentStates } from "@openbot/ui/features/sidebar/sidebar-agent-states";
import type { SidebarAgentState } from "@openbot/ui/features/sidebar/sidebar-types";
import { createEffect, createMemo, createSignal, onSettled, untrack } from "solid-js";
import { toAgentMessages, toAgentProfile } from "../../app-message-projection";
import { createScopeGuard } from "../../scope-lifetime";
import { createSimpleContext } from "../../simple-context";
import { readAgentSelection } from "../agents/agent-selection";
import { useAgents } from "../agents/agents-context";
import { useConversation } from "../conversation/conversation-context";
import { serverSupportsCapability } from "../servers/server-capabilities";
import { useServers } from "../servers/servers-context";
import { useSettings } from "../settings/settings-context";
import { useSidebar } from "../sidebar/sidebar-context";
import { usePresence } from "../team/team-context";
import { savedCopyPort } from "./saved-copy-port";
import { createThrottledSave } from "./saved-copy-writer";

/** The shortest time between two saves of one part of the copy. */
const SAVE_INTERVAL_MS = 2_000;

/**
 * The saved copy of a joined server: what the sidebar and the open chat showed the last time, shown
 * while the server connects after a launch, and saved again from what the server sends.
 *
 * The copy never enters the live state. The roster, the open agent and the transcript of this scope
 * stay empty until the server answers, so nothing that reads them asks the host about an agent that
 * only the copy names. That matters: a host creates an agent again when it is asked for the
 * conversation of an id it no longer has, and the copy can name an agent that was deleted since.
 * The copy is read-only for the same reason. The sidebar shows it without the actions that need the
 * host, and the chat area shows its messages without a composer.
 *
 * Main decides whether there is a copy: it keeps none while the setting is off, and it keeps the copy
 * of the signed-in account only. The copy is shown until the first roster read of the scope settles,
 * and only while the server connects; a server with an error or an issue shows its own state.
 */
const SavedCopy = createSimpleContext({
  name: "Saved copy",
  init: () => {
    const { activeServer, activeServerId, initialServersReady } = useServers();
    const { activeAgent, agentListConnecting, agentListSettled, rememberAgentSelection, storedAgents } = useAgents();
    const { conversations, onLatestMessages } = useConversation();
    const { sidebarLayout } = useSidebar();
    const { currentTeamMember } = usePresence();
    const { savedCopyEnabled } = useSettings();
    const serverId = untrack(activeServerId);
    const scopeIsCurrent = createScopeGuard();

    const [copy, setCopy] = createSignal<RemoteWorkspaceCache | null>(null);
    const [selectedAgentId, setSelectedAgentId] = createSignal("");

    const visible = createMemo(() => copy() !== null && agentListConnecting());
    const agents = createMemo((): AgentProfile[] => copy()?.agents.map(toAgentProfile) ?? []);
    const layout = createMemo((): SidebarLayoutSnapshot | null => copy()?.layout ?? null);
    // The agent the user picked here, or else the one open at the last launch, or else the chat that
    // was saved last.
    const selectedAgent = createMemo(() => {
      const list = agents();
      const lastSaved = copy()?.conversations[0]?.agentId;
      return (
        list.find((agent) => agent.id === selectedAgentId()) ?? list.find((agent) => agent.id === lastSaved) ?? list[0]
      );
    });
    const messages = createMemo((): AgentMessage[] => {
      const agentId = selectedAgent()?.id;
      const saved = copy()?.conversations.find((conversation) => conversation.agentId === agentId);
      return saved && agentId ? toAgentMessages(saved.messages, agentId) : [];
    });
    const agentStates = createMemo((): Record<string, SidebarAgentState> => {
      const saved = copy();
      if (!saved) return {};
      return computeSidebarAgentStates({
        agentIds: saved.agents.map((agent) => agent.id),
        activeTurns: {},
        queues: {},
        unreadReplies: Object.fromEntries(
          Object.entries(saved.reads).map(([agentId, read]) => [agentId, read.unreadCount]),
        ),
        recentReplies: {},
        pendingPrompts: {},
        pendingApprovals: {},
        failedTurns: {},
        usageLimits: {},
      });
    });

    function select(agentId: string): void {
      setSelectedAgentId(agentId);
      rememberAgentSelection(agentId);
    }

    function load(): void {
      if (!scopeIsCurrent() || activeServer()?.kind !== "remote" || agentListSettled()) return;
      void savedCopyPort()
        .remoteWorkspaceCache.read(serverId)
        .then((saved) => {
          if (!saved || !scopeIsCurrent() || agentListSettled() || saved.serverId !== serverId) return;
          const preferred = readAgentSelection()[serverId];
          setSelectedAgentId(saved.agents.some((agent) => agent.id === preferred) ? (preferred ?? "") : "");
          setCopy(saved);
        })
        .catch(() => undefined);
    }

    // What the server sent, saved for the next launch. Main drops it while the setting is off.
    function saveWorkspace(input: SaveRemoteWorkspaceInput): Promise<void> {
      return savedCopyPort()
        .remoteWorkspaceCache.saveWorkspace(input)
        .catch(() => undefined);
    }
    function saveConversation(agentId: string, messages: ConversationMessage[]): void {
      void savedCopyPort()
        .remoteWorkspaceCache.saveConversation({ serverId, agentId, messages })
        .catch(() => undefined);
    }
    const workspaceSave = createThrottledSave(
      (input: SaveRemoteWorkspaceInput) => void saveWorkspace(input),
      SAVE_INTERVAL_MS,
    );
    const conversationSaves = new Map<string, ReturnType<typeof createThrottledSave<ConversationMessage[]>>>();
    /** The latest messages of the open chat, kept to save them at once when the setting turns on. */
    let latestConversation: { agentId: string; messages: ConversationMessage[] } | null = null;

    const workspaceInput = createMemo((): SaveRemoteWorkspaceInput | null => {
      const stored = storedAgents();
      // Only a roster the server sent. A failed read settles the scope too, and saving its empty
      // roster would delete the copy.
      if (!stored || activeServer()?.kind !== "remote") return null;
      // Main accepts and keeps at most this many agents. A larger roster is cut here, so that the copy
      // still follows the server.
      const agents = stored.slice(0, REMOTE_WORKSPACE_CACHE_LIMITS.agents);
      const reads: Record<string, ConversationReadState> = {};
      for (const agent of agents) {
        const read = conversations[agent.id]?.read;
        if (read) {
          reads[agent.id] = {
            unreadCount: read.unreadCount,
            firstUnreadMessageId: read.firstUnreadMessageId,
            throughMessageId: read.throughMessageId,
          };
        }
      }
      const layout = serverSupportsCapability(activeServer(), "sidebar-layout") ? sidebarLayout() : null;
      return { serverId, memberId: currentTeamMember()?.id ?? null, agents, reads, layout };
    });

    createEffect(workspaceInput, (input) => {
      if (input) workspaceSave.offer(input);
    });

    // Main dropped the saves while the setting was off, and an idle chat sends nothing new. When main
    // confirms that the setting is on, the roster and the open chat are saved at once.
    createEffect(savedCopyEnabled, (enabled, previous) => {
      if (!enabled || previous) return;
      const input = workspaceInput();
      if (!input) return;
      const latest = latestConversation;
      // Main keeps a chat only of an agent in the saved roster, so the chat follows the roster.
      void saveWorkspace(input).then(() => {
        if (latest && scopeIsCurrent() && activeAgent()?.id === latest.agentId) {
          saveConversation(latest.agentId, latest.messages);
        }
      });
    });

    onSettled(() => {
      void initialServersReady.then(load);
      const stopListening = onLatestMessages((agentId, latest) => {
        if (!storedAgents() || activeServer()?.kind !== "remote" || activeAgent()?.id !== agentId) return;
        let save = conversationSaves.get(agentId);
        if (!save) {
          save = createThrottledSave(
            (messages: ConversationMessage[]) => saveConversation(agentId, messages),
            SAVE_INTERVAL_MS,
          );
          conversationSaves.set(agentId, save);
        }
        const messages = latest.slice(-60);
        latestConversation = { agentId, messages };
        save.offer(messages);
      });
      return () => {
        stopListening();
        // A save that still waits is the newest state of a server the user leaves: write it now.
        workspaceSave.flush();
        for (const save of conversationSaves.values()) save.flush();
      };
    });

    return {
      memberId: () => copy()?.memberId ?? null,
      visible,
      agents,
      layout,
      agentStates,
      selectedAgent,
      messages,
      select,
      openUrl: (url: string) => savedCopyPort().openUrl(url),
    };
  },
});

export const SavedCopyProvider = SavedCopy.provider;
export const useSavedCopy = SavedCopy.use;
