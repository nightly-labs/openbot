import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AGENT_DOCK_LIMITS,
  type AgentDockAgent,
  type AgentDockChat,
  type AgentDockMessage,
  type AgentDockPresentation,
  type AgentDockResult,
  type AgentDockSeatState,
  isAttachmentSummary,
} from "@openbot/contracts/ipc";
import type { AgentMessage, ComposerAgent } from "@openbot/ui/data";
import { AgentDock, type AgentDockChatModel } from "@openbot/ui/features/agent-dock/AgentDock";
import { isDockMessage } from "@openbot/ui/features/agent-dock/AgentDockChat";
import { markdownPlainText } from "@openbot/ui/features/conversation/MarkdownMessageText";
import { sidebarAgentOrder } from "@openbot/ui/features/sidebar/sidebar-agent-order";
import type { SidebarAgentState } from "@openbot/ui/features/sidebar/sidebar-types";
import { createEffect, createMemo, createSignal, Match, onCleanup, onSettled, Show, Switch } from "solid-js";
import { appPort } from "../../app-port";
import { useNavigation } from "../../navigation";
import { usePlatform } from "../../platform";
import { createAgentActivity } from "../agents/agent-activity";
import { useAgents } from "../agents/agents-context";
import { useConversation } from "../conversation/conversation-context";
import { latestVisibleAgentMessageId } from "../conversation/conversation-read-state";
import { useServers } from "../servers/servers-context";
import { useSettings } from "../settings/settings-context";
import { useSidebar } from "../sidebar/sidebar-context";
import { agentDockPort } from "./agent-dock-port";
import {
  type AgentDockPlacement,
  agentDockSeats,
  sameAgentDockSeats,
  saveAgentDockOffset,
  setAgentDockSeats,
  useAgentDockPreference,
} from "./agent-dock-preference";
import { createAgentDockVoice } from "./agent-dock-voice";

/**
 * Where this window shows the dock. Null hides the dock: the user turned it off, the platform is not
 * known yet, or it is not macOS. The agent dock is a macOS feature.
 */
export function useAgentDockPlacement(): () => AgentDockPlacement | null {
  const platform = usePlatform();
  const preference = useAgentDockPreference();
  return () => {
    const info = platform.appInfo();
    if (info?.platform !== "darwin" || !preference().shown) return null;
    return preference().placement;
  };
}

/**
 * The agent dock of the active server, on macOS only. Each server has its own dock. By default the dock
 * is a window of its own at the right edge of the screen, above the other apps; this renderer publishes
 * what it shows. The user can keep it in the main window instead.
 */
export function AgentDockHost() {
  const { activeServerId } = useServers();
  const placement = useAgentDockPlacement();

  /* The window hides when no server is active, when the dock is off or in the main window, and when
     this renderer goes away. */
  const hideScreenDock = () =>
    void agentDockPort()
      .agentDock.publishPresentation(null)
      .catch(() => undefined);
  createEffect(
    () => placement() !== "screen" || !activeServerId(),
    (hidden) => {
      if (hidden) hideScreenDock();
    },
  );
  onCleanup(() => {
    if (placement() === "screen") hideScreenDock();
  });

  return (
    <Show when={activeServerId()} keyed>
      {(serverId) => (
        <Switch>
          <Match when={placement() === "screen"}>
            <ScreenAgentDock serverId={serverId} />
          </Match>
          <Match when={placement() === "window"}>
            <WindowAgentDock serverId={serverId} />
          </Match>
        </Switch>
      )}
    </Show>
  );
}

/** The seats, the agents and the chats of one server's dock, and what its actions change. */
function createServerDock(serverId: string, options: { readWhenHidden: boolean }) {
  const { agentList, userHiddenAgentIds } = useAgents();
  const { conversations, markAgentMessagesRead, loadLatestAgentMessages, clearRecentReply } = useConversation();
  const { workingTurns, agentStates, agentMoods } = createAgentActivity();
  const { sidebarLayout, pinnedSidebarItems } = useSidebar();
  const preference = useAgentDockPreference();
  const seatIds = createMemo(
    () =>
      agentDockSeats(
        serverId,
        () =>
          sidebarAgentOrder(agentList(), {
            layout: sidebarLayout(),
            pinnedItems: pinnedSidebarItems(),
            hiddenAgentIds: userHiddenAgentIds(),
          }).map((agent) => agent.id),
        userHiddenAgentIds(),
      ),
    { equals: sameAgentDockSeats },
  );
  const [openAgentId, setOpenAgentId] = createSignal<string | null>(null);

  const saveSeats = (seats: string[]) => setAgentDockSeats(serverId, seats);

  /* A deleted or hidden agent leaves the dock without a change to the saved list: an agent list that
     is still loading must not empty the dock. */
  const shownAgents = createMemo(() => agentList().filter((agent) => !userHiddenAgentIds().has(agent.id)));
  const seats = createMemo(() => {
    const agents = new Map(shownAgents().map((agent) => [agent.id, agent]));
    return seatIds().flatMap((id) => {
      const agent = agents.get(id);
      return agent ? [{ agent, mood: agentMoods()[id] ?? "idle", state: agentStates()[id] }] : [];
    });
  });
  const available = createMemo(() => {
    const seated = new Set(seatIds());
    return shownAgents().filter((agent) => !seated.has(agent.id));
  });

  const chat = (agentId: string): AgentDockChatModel => {
    const state = agentStates()[agentId];
    return {
      messages: conversations[agentId]?.messages ?? [],
      working: Boolean(workingTurns()[agentId]),
      wait: state?.kind === "waiting" ? state.reason : null,
    };
  };

  /* The open chat is on screen, so its new answers are read, as in the main window. The dock window is
     on screen when the main window is not, so there the visibility of this page does not count. */
  createEffect(
    () => {
      const agentId = openAgentId();
      return agentId ? { agentId, latest: latestVisibleAgentMessageId(conversations[agentId]?.messages) } : null;
    },
    (open) => {
      if (!open?.latest) return;
      if (!options.readWhenHidden && document.visibilityState !== "visible") return;
      clearRecentReply(open.agentId);
      void markAgentMessagesRead(open.agentId, open.latest, serverId).catch(() => undefined);
    },
  );

  /* The unread answers of the seated agents, for the finished-work shelf. The shelf hides each one
     after some time; the seat keeps its unread badge. */
  let firstSeen = new Map<string, number>();
  const results = createMemo((): AgentDockResult[] => {
    if (!preference().results) return [];
    /* An answer with no time keeps the time when the dock first saw it, so the presentation stays the same. */
    const seen = new Map<string, number>();
    const seenAt = (id: string) => {
      const at = firstSeen.get(id) ?? Date.now();
      seen.set(id, at);
      return at;
    };
    const all = seats().flatMap((seat) => {
      const conversation = conversations[seat.agent.id];
      const unread = conversation?.read?.unreadCount ?? 0;
      if (unread <= 0 || workingTurns()[seat.agent.id]) return [];
      return unreadAnswers(
        conversation?.messages ?? [],
        unread,
        conversation?.read?.firstUnreadMessageId ?? null,
      ).flatMap((message) => dockResult(seat.agent.id, message, seenAt) ?? []);
    });
    firstSeen = seen;
    return all.sort((a, b) => a.at - b.at).slice(-AGENT_DOCK_LIMITS.results);
  });

  return {
    agents: agentList,
    seats,
    available,
    results,
    chat,
    openAgentId,
    openChat(agentId: string | null) {
      setOpenAgentId(agentId);
      // The main window keeps the latest page of every agent it has opened; another agent loads it here.
      if (agentId && !conversations[agentId]?.messages?.length) void loadLatestAgentMessages(agentId);
    },
    add(agentId: string) {
      if (!seatIds().includes(agentId)) saveSeats([...seatIds(), agentId]);
    },
    remove(agentId: string) {
      saveSeats(seatIds().filter((id) => id !== agentId));
    },
  };
}

/** The dock inside the main window, when the user does not want it above the other apps. */
function WindowAgentDock(props: { serverId: string }) {
  const { sendMessage } = useConversation();
  const { selectAgent } = useNavigation();
  const { openAppSettings } = useSettings();
  const dock = createServerDock(props.serverId, { readWhenHidden: false });
  const voice = createAgentDockVoice(() => props.serverId);

  return (
    <AgentDock
      seats={dock.seats()}
      available={dock.available()}
      chat={dock.chat}
      onOpenChange={dock.openChat}
      onAdd={dock.add}
      onRemove={dock.remove}
      onSend={(agentId, text) => sendMessage(text, [], null, { agentId, serverId: props.serverId })}
      onOpenInMain={(agentId) => selectAgent(agentId)}
      onOpenWindow={(agentId) => void appPort().openChatWindow({ serverId: props.serverId, agentId })}
      voice={voice}
      agents={dock.agents()}
      onSelectAgent={(agentId) => selectAgent(agentId)}
      onOpenLink={(url) => void appPort().openUrl(url)}
      onOpenSettings={() => openAppSettings(null, "agent-dock")}
      results={dock.results()}
    />
  );
}

/**
 * Publishes the dock to its window at the screen edge and does the actions that the window sends back.
 * Main sends the messages typed in the dock, so `send` does not come here.
 */
function ScreenAgentDock(props: { serverId: string }) {
  const { conversations } = useConversation();
  const { selectAgent } = useNavigation();
  const { openAppSettings } = useSettings();
  const preference = useAgentDockPreference();
  const dock = createServerDock(props.serverId, { readWhenHidden: true });

  /* Only the open chat goes to the window: a streamed answer then sends one chat, not every seat's. */
  const presentation = createMemo(
    (): AgentDockPresentation => ({
      serverId: props.serverId,
      display: { ...preference().display },
      edge: preference().edge,
      autoHide: preference().autoHide,
      offsets: preference().offsets.map((item) => ({ ...item })),
      seats: dock
        .seats()
        .slice(0, AGENT_DOCK_LIMITS.seats)
        .map((seat) => ({ agent: dockAgent(seat.agent), mood: seat.mood, state: dockSeatState(seat.state) })),
      available: dock.available().slice(0, INPUT_LIMITS.agents).map(dockAgent),
      agents: dock.agents().slice(0, INPUT_LIMITS.agents).map(dockAgent),
      chats: openChats(dock.openAgentId(), dock.chat, (agentId) => conversations[agentId]?.messages ?? []),
      results: dock.results(),
    }),
  );

  /* One publish at a time; the newest presentation goes next. A fast stream then waits for main. */
  let disposed = false;
  let publishing = false;
  let pending: AgentDockPresentation | null = null;
  const publish = (next: AgentDockPresentation) => {
    pending = next;
    if (publishing) return;
    publishing = true;
    const drain = (): Promise<void> => {
      const value = pending;
      pending = null;
      if (!value || disposed) {
        publishing = false;
        return Promise.resolve();
      }
      // A clone error throws at the call. It must not reach the effect, which would halt this renderer.
      return Promise.resolve()
        .then(() => agentDockPort().agentDock.publishPresentation(value))
        .catch(() => undefined)
        .then(drain);
    };
    void drain();
  };
  createEffect(presentation, (next) => publish(next));

  onSettled(() => {
    const unsubscribe = agentDockPort().agentDock.onAction((action) => {
      if (action.type === "open-link") {
        void appPort().openUrl(action.url);
        return;
      }
      if (action.type === "open-settings") {
        openAppSettings(null, "agent-dock");
        return;
      }
      if (action.serverId !== props.serverId) return;
      switch (action.type) {
        case "open-chat":
          dock.openChat(action.agentId);
          return;
        case "add":
          dock.add(action.agentId);
          return;
        case "remove":
          dock.remove(action.agentId);
          return;
        case "open-agent":
          selectAgent(action.agentId);
          return;
        case "open-window":
          void appPort().openChatWindow({ serverId: action.serverId, agentId: action.agentId });
          return;
        case "send":
          return;
      }
    });
    // A drag of the dock ended. The position stays for the display, also after a restart.
    const stopMoved = agentDockPort().agentDock.onMoved(saveAgentDockOffset);
    return () => {
      disposed = true;
      unsubscribe();
      stopMoved();
    };
  });

  return null;
}

function dockAgent(agent: ComposerAgent): AgentDockAgent {
  return {
    id: agent.id,
    name: agent.name.slice(0, INPUT_LIMITS.agentName),
    title: agent.title.slice(0, INPUT_LIMITS.agentTitle),
    description: agent.description.slice(0, INPUT_LIMITS.agentDescription),
    avatarSeed: agent.avatarSeed.slice(0, INPUT_LIMITS.identifier),
    avatarHue: agent.avatarHue ?? null,
    avatarColor: agent.avatarColor ?? null,
    avatarUrl: agent.avatarUrl && agent.avatarUrl.length <= INPUT_LIMITS.avatarUrl ? agent.avatarUrl : null,
  };
}

/** Plain copies: the IPC clone refuses the store proxies that the app state is made of. */
function dockSeatState(state: SidebarAgentState | undefined): AgentDockSeatState | null {
  if (!state) return null;
  const count = (value: number) => Math.min(Math.max(0, Math.floor(value)), AGENT_DOCK_LIMITS.count);
  switch (state.kind) {
    case "waiting":
      return {
        kind: "waiting",
        reason: state.reason,
        detail: state.detail?.slice(0, INPUT_LIMITS.directMessageText) ?? null,
      };
    case "working":
    case "responded":
      return { kind: state.kind };
    case "unread":
      return { kind: "unread", count: count(state.count) };
    case "routine":
      return { kind: "routine", phase: state.phase, count: count(state.count) };
    case "limited":
      return { kind: "limited", resetsAt: state.resetsAt === null ? null : Math.max(0, Math.floor(state.resetsAt)) };
  }
}

function openChats(
  agentId: string | null,
  chat: (agentId: string) => AgentDockChatModel,
  messages: (agentId: string) => readonly AgentMessage[],
): AgentDockChat[] {
  if (!agentId) return [];
  const model = chat(agentId);
  return [
    {
      agentId,
      messages: messages(agentId).filter(isDockMessage).slice(-AGENT_DOCK_LIMITS.messages).map(dockMessage),
      working: model.working,
      wait: model.wait,
    },
  ];
}

function dockMessage(message: AgentMessage): AgentDockMessage {
  return {
    id: message.id.slice(0, INPUT_LIMITS.identifier),
    author: message.author,
    kind: message.kind === "error" ? "error" : "text",
    body: message.body.slice(0, INPUT_LIMITS.messageText),
    attachments: (message.attachments ?? [])
      .filter(isAttachmentSummary)
      .slice(0, INPUT_LIMITS.attachments)
      .map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        size: attachment.size,
        kind: attachment.kind,
        mimeType: attachment.mimeType,
        previewKind: attachment.previewKind,
        previewUrl: attachment.previewUrl,
      })),
  };
}

/** The unread agent answers: from the first unread message, or the last `count` messages. */
function unreadAnswers(messages: readonly AgentMessage[], count: number, firstUnreadId: string | null): AgentMessage[] {
  const first = firstUnreadId === null ? -1 : messages.findIndex((message) => message.id === firstUnreadId);
  const unread = first >= 0 ? messages.slice(first) : messages.slice(-count);
  return unread.filter(
    (message) => message.author === "agent" && isDockMessage(message) && message.kind !== "error" && !message.streaming,
  );
}

const RESULT_LABEL = 120;
/** A Markdown block marker at the start of a line: a heading, a quote, or a list item. */
const BLOCK_MARKER = /^(#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/;

/** A plain copy of one answer for the shelf: its first file, or else its first line of text. */
function dockResult(
  agentId: string,
  message: AgentMessage,
  seenAt: (messageId: string) => number,
): AgentDockResult | null {
  const file = (message.attachments ?? []).find(isAttachmentSummary);
  const line = message.body
    .split("\n")
    .map((text) => markdownPlainText(text.trim().replace(BLOCK_MARKER, "")).trim())
    .find((text) => text.length > 0);
  const label = (file?.name ?? line ?? "").slice(0, Math.min(RESULT_LABEL, AGENT_DOCK_LIMITS.resultLabel));
  if (!label) return null;
  const at = message.createdAt ? Date.parse(message.createdAt) : Number.NaN;
  return {
    id: message.id.slice(0, INPUT_LIMITS.identifier),
    agentId,
    kind: file ? "file" : "message",
    label,
    at: Number.isFinite(at) && at >= 0 ? at : seenAt(message.id),
  };
}
