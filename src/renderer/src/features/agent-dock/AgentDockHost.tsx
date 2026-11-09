import { leadingAddress } from "@openbot/contracts/chat-tag-references";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AGENT_DOCK_LIMITS,
  type AgentDockAgent,
  type AgentDockChannel,
  type AgentDockChat,
  type AgentDockMessage,
  type AgentDockPresentation,
  type AgentDockResult,
  type AgentDockSeat,
  type AgentDockSeatRef,
  type AgentDockSeatState,
  type ChannelPage,
  type ChannelSummary,
  isAttachmentSummary,
} from "@openbot/contracts/ipc";
import type { AgentMessage, ComposerAgent } from "@openbot/ui/data";
import {
  AgentDock,
  type AgentDockChatModel,
  type AgentDockSendResult,
  type AgentDockChannel as AgentDockUiChannel,
  type AgentDockSeat as AgentDockUiSeat,
} from "@openbot/ui/features/agent-dock/AgentDock";
import { isDockMessage } from "@openbot/ui/features/agent-dock/AgentDockChat";
import { markdownPlainText } from "@openbot/ui/features/conversation/MarkdownMessageText";
import { sidebarAgentOrder } from "@openbot/ui/features/sidebar/sidebar-agent-order";
import { sidebarChannelWaits, sidebarUnreadBadge } from "@openbot/ui/features/sidebar/sidebar-agent-states";
import type { SidebarAgentState } from "@openbot/ui/features/sidebar/sidebar-types";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, Match, onCleanup, onSettled, Show, Switch } from "solid-js";
import { appPort } from "../../app-port";
import { useNavigation } from "../../navigation";
import { usePlatform } from "../../platform";
import { useTurns } from "../../turns";
import { useAuth } from "../account/account-context";
import { createAgentActivity } from "../agents/agent-activity";
import { useAgents } from "../agents/agents-context";
import {
  channelConversationRows,
  channelMessageHasContent,
  sentChannelMessageId,
} from "../channels/channel-conversation-rows";
import { useChannels } from "../channels/channels-context";
import { useConversation } from "../conversation/conversation-context";
import { latestVisibleAgentMessageId } from "../conversation/conversation-read-state";
import { useServers } from "../servers/servers-context";
import { useSettings } from "../settings/settings-context";
import { useSidebar } from "../sidebar/sidebar-context";
import { isReaderAuthor } from "../team/reader-identity";
import { usePresence } from "../team/team-context";
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
 * known yet, or it has no dock. On Linux with Wayland windows, the dock above other apps waits for a
 * start on XWayland, and shows in the window until then.
 */
export function useAgentDockPlacement(): () => AgentDockPlacement | null {
  const platform = usePlatform();
  const preference = useAgentDockPreference();
  return () => {
    const info = platform.appInfo();
    if (!info || !preference().shown) return null;
    const placement = preference().placement;
    return placement === "screen" && info.aboveAppsSupport ? "window" : placement;
  };
}

/**
 * The agent dock of the active server, on macOS, Windows and Linux. Each server has its own dock. By default the dock
 * is a window of its own at the right edge of the screen, above the other apps; this renderer publishes
 * what it shows. The user can keep it in the main window instead.
 */
export function AgentDockHost() {
  const { activeServerId } = useServers();
  const placement = useAgentDockPlacement();
  const platform = usePlatform();
  const preference = useAgentDockPreference();

  /* Linux: a dock that is off or in the window does not need XWayland, so the next start on a Wayland
     session uses Wayland again. A dock that the user turns on again on XWayland keeps it; a dock that
     was on at start does not, so a start on XWayland for another reason stays a single start. On
     Wayland, only the restart in the settings turns it on. */
  let wasOn: boolean | undefined;
  createEffect(
    () => {
      const info = platform.appInfo();
      if (info?.platform !== "linux") return undefined;
      return {
        on: preference().shown && preference().placement === "screen",
        onWayland: info.aboveAppsSupport !== undefined,
      };
    },
    (state) => {
      if (state === undefined) return;
      const turnedOn = state.on && wasOn === false;
      wasOn = state.on;
      if (state.on && (!turnedOn || state.onWayland)) return;
      void agentDockPort()
        .agentDock.setXWayland({ enabled: state.on })
        .catch(() => undefined);
    },
  );

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

/** The seats, the agents, the channels and the chats of one server's dock, and what its actions change. */
function createServerDock(serverId: string, options: { readWhenHidden: boolean }) {
  const { agentList, userHiddenAgentIds } = useAgents();
  const { conversations, markAgentMessagesRead, loadLatestAgentMessages, clearRecentReply } = useConversation();
  const { workingTurns, agentStates, agentMoods } = createAgentActivity();
  const { sidebarLayout, pinnedSidebarItems } = useSidebar();
  const channels = useChannels();
  const { approvals, pendingPrompts } = useTurns();
  const { currentTeamMember } = usePresence();
  const auth = useAuth();
  const { activeServer } = useServers();
  const { t, errorMessage } = useText();
  const preference = useAgentDockPreference();
  const seatRefs = createMemo(
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
  const [openSeat, setOpenSeat] = createSignal<AgentDockSeatRef | null>(null);
  const openChannelId = createMemo(() => {
    const seat = openSeat();
    return seat?.kind === "channel" ? seat.id : null;
  });
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  /** A send that failed. A retry of the same text keeps its operation, so the channel gets the message once. */
  let failedSend: { channelId: string; text: string; operationId: string } | null = null;

  const saveSeats = (seats: readonly AgentDockSeatRef[]) => setAgentDockSeats(serverId, seats);
  const seated = (seat: AgentDockSeatRef) => seatRefs().some((item) => item.kind === seat.kind && item.id === seat.id);

  /* A deleted or hidden agent, and a deleted channel, leave the dock without a change to the saved list:
     a list that is still loading must not empty the dock. */
  const shownAgents = createMemo(() => agentList().filter((agent) => !userHiddenAgentIds().has(agent.id)));
  const shownChannels = createMemo(() =>
    channels.supported() ? channels.state.channels.filter((channel) => !channel.archived) : [],
  );
  /* A wait in a channel thread goes to the channel, as in the sidebar. */
  const channelWaits = createMemo(() => {
    const prompts = Object.values(pendingPrompts());
    return sidebarChannelWaits({
      channels: shownChannels(),
      prompts: prompts.flatMap((event) => (event?.type === "prompt" ? [event] : [])),
      takeovers: prompts.flatMap((event) => (event?.type === "browser-takeover-requested" ? [event.request] : [])),
      approvals: approvals(),
    });
  });
  /* The badge of the sidebar row; work that runs shows when the channel has no other badge. */
  const channelState = (channel: ChannelSummary): SidebarAgentState | undefined =>
    sidebarUnreadBadge(channel.unreadCount, channelWaits()[channel.id]) ??
    (channel.activeTasks > 0 ? { kind: "working" } : undefined);
  const seats = createMemo((): AgentDockUiSeat[] => {
    const agents = new Map(shownAgents().map((agent) => [agent.id, agent]));
    const channelById = new Map(shownChannels().map((channel) => [channel.id, channel]));
    return seatRefs().flatMap((seat): AgentDockUiSeat[] => {
      if (seat.kind === "agent") {
        const agent = agents.get(seat.id);
        return agent
          ? [{ kind: "agent", agent, mood: agentMoods()[seat.id] ?? "idle", state: agentStates()[seat.id] }]
          : [];
      }
      const channel = channelById.get(seat.id);
      return channel ? [{ kind: "channel", channel: dockChannel(channel), state: channelState(channel) }] : [];
    });
  });
  const available = createMemo(() => shownAgents().filter((agent) => !seated({ kind: "agent", id: agent.id })));
  const availableChannels = createMemo(() =>
    shownChannels()
      .filter((channel) => !seated({ kind: "channel", id: channel.id }))
      .map(dockChannel),
  );

  const isOwnSender = (senderId: string) => {
    const state = auth.centralAuth();
    return isReaderAuthor(senderId, {
      memberId: currentTeamMember()?.id ?? null,
      accountUserId: state.status === "signed_in" ? state.user.id : null,
      onOwnComputer: activeServer()?.kind === "local",
    });
  };

  /* The page of the open channel: the one the main window shows, or one that the dock reads itself. A
     change of the channel on the host reads it again. */
  const [readPage, setReadPage] = createSignal<ChannelPage | null>(null);
  const channelPage = (channelId: string): ChannelPage | null => {
    const selected = channels.state.page;
    if (selected?.channel.id === channelId) return selected;
    const read = readPage();
    return read?.channel.id === channelId ? read : null;
  };
  let readId = 0;
  /** The channel that a read runs for. Changes during that read start one more read when it ends. */
  let reading: string | null = null;
  let readAgain = false;
  const readChannel = (channelId: string) => {
    if (reading === channelId) {
      readAgain = true;
      return;
    }
    const id = ++readId;
    reading = channelId;
    readAgain = false;
    void channels
      .port()
      .agent.readChannel({ channelId })
      .then((page) => {
        if (!disposed && id === readId && openChannelId() === channelId) setReadPage(page);
      })
      .catch(() => undefined)
      .finally(() => {
        if (id !== readId) return;
        reading = null;
        if (readAgain && !disposed && openChannelId() === channelId) readChannel(channelId);
      });
  };
  /* The main window that leaves the open channel stops updating its page, so the dock reads it again. */
  const mainChannelId = createMemo(() => channels.state.page?.channel.id ?? null);
  createEffect(
    () => [openChannelId(), mainChannelId()] as const,
    ([channelId, mainId]) => {
      if (channelId && mainId !== channelId) readChannel(channelId);
    },
  );
  onCleanup(
    channels.onChange((changed) => {
      const channelId = openChannelId();
      if (!channelId || (changed !== null && changed !== channelId)) return;
      if (channels.state.page?.channel.id !== channelId) readChannel(channelId);
    }),
  );

  /* The channel that the chat shows. It stays after a close, so the chat keeps its rows while it fades. */
  const shownChannelId = createMemo((previous?: string | null) => openChannelId() ?? previous ?? null);
  /* The dock shows a message with no sender as the reader's own. A signed-in reader's messages carry their sender. */
  const ownCopies = new WeakMap<AgentMessage, AgentMessage>();
  const asOwn = (message: AgentMessage): AgentMessage => {
    if (message.author !== "you" || !message.senderMember || !isOwnSender(message.senderMember.id)) return message;
    /* A copy stays the same while the text, the kind and the files of its message stay: the chat reads it
       again for each streamed word of an answer, and a new copy would draw the row again. */
    const copy = ownCopies.get(message);
    if (copy && copy.body === message.body && copy.kind === message.kind && copy.attachments === message.attachments)
      return copy;
    const { senderMember: _own, ...own } = message;
    ownCopies.set(message, own);
    return own;
  };
  /* The rows of the shown channel. */
  const channelMessages = createMemo((): AgentMessage[] => {
    const channelId = shownChannelId();
    const page = channelId ? channelPage(channelId) : null;
    if (!page) return [];
    return channelConversationRows(page.messages.filter(channelMessageHasContent)).map(asOwn);
  });
  const agentMessages = (agentId: string): AgentMessage[] => (conversations[agentId]?.messages ?? []).map(asOwn);

  const chat = (seat: AgentDockSeatRef): AgentDockChatModel => {
    if (seat.kind === "channel") {
      const summary = shownChannels().find((channel) => channel.id === seat.id);
      return {
        messages: shownChannelId() === seat.id ? channelMessages() : [],
        working: (summary?.activeTasks ?? 0) > 0,
        wait: channelWaits()[seat.id]?.reason ?? null,
      };
    }
    const state = agentStates()[seat.id];
    return {
      messages: agentMessages(seat.id),
      working: Boolean(workingTurns()[seat.id]),
      wait: state?.kind === "waiting" ? state.reason : null,
    };
  };

  /* The open chat is on screen, so its new answers are read, as in the main window. The dock window is
     on screen when the main window is not, so there the visibility of this page does not count. */
  const readable = () => options.readWhenHidden || document.visibilityState === "visible";
  createEffect(
    () => {
      const seat = openSeat();
      return seat?.kind === "agent"
        ? { agentId: seat.id, latest: latestVisibleAgentMessageId(conversations[seat.id]?.messages) }
        : null;
    },
    (open) => {
      if (!open?.latest || !readable()) return;
      clearRecentReply(open.agentId);
      void markAgentMessagesRead(open.agentId, open.latest, serverId).catch(() => undefined);
    },
  );
  /* A channel is read through the newest message of its page, once for each new message. */
  const channelReadThrough = new Map<string, number>();
  createEffect(
    () => {
      const channelId = openChannelId();
      if (!channelId) return null;
      const unread = shownChannels().find((channel) => channel.id === channelId)?.unreadCount ?? 0;
      const page = channelPage(channelId);
      return unread > 0 && page ? { channelId, throughSequence: page.throughSequence } : null;
    },
    (open) => {
      if (!open || !readable()) return;
      if ((channelReadThrough.get(open.channelId) ?? 0) >= open.throughSequence) return;
      channelReadThrough.set(open.channelId, open.throughSequence);
      void channels
        .port()
        .agent.channelCommand({
          type: "read",
          channelId: open.channelId,
          throughSequence: open.throughSequence,
          operationId: crypto.randomUUID(),
        })
        .catch(() => channelReadThrough.delete(open.channelId));
    },
  );

  /* The unread answers of the seated agents, for the finished-work shelf. The shelf hides each one
     after some time; the seat keeps its unread badge. Channels have no results. */
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
      if (seat.kind !== "agent") return [];
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
    availableChannels,
    results,
    chat,
    channelMessages,
    agentMessages,
    openSeat,
    openChat(seat: AgentDockSeatRef | null) {
      setOpenSeat(seat ? { kind: seat.kind, id: seat.id } : null);
      // The main window keeps the latest page of every agent it has opened; another agent loads it here.
      if (seat?.kind === "agent" && !conversations[seat.id]?.messages?.length) void loadLatestAgentMessages(seat.id);
    },
    add(seat: AgentDockSeatRef) {
      if (!seated(seat)) saveSeats([...seatRefs(), { kind: seat.kind, id: seat.id }]);
    },
    remove(seat: AgentDockSeatRef) {
      saveSeats(seatRefs().filter((item) => item.kind !== seat.kind || item.id !== seat.id));
    },
    /** The same send as in the channel view of the main window. A retry keeps the operation of the failed send. */
    async sendToChannel(channelId: string, text: string): Promise<AgentDockSendResult> {
      const sequenceBefore = channelPage(channelId)?.throughSequence ?? 0;
      const operationId =
        failedSend && failedSend.channelId === channelId && failedSend.text === text
          ? failedSend.operationId
          : crypto.randomUUID();
      failedSend = { channelId, text, operationId };
      try {
        const after = await channels.send({
          type: "send",
          operationId,
          channelId,
          text,
          // A message that opens with a member is addressed to that member.
          recipientAgentId: leadingAddress(text).mentions[0]?.id ?? null,
          replyToMessageId: null,
          attachmentDraftIds: [],
        });
        if (!disposed && openChannelId() === channelId && channels.state.page?.channel.id !== channelId)
          setReadPage(after);
        const messageId = sentChannelMessageId(after, sequenceBefore, text, isOwnSender);
        if (!messageId) return { error: t("channel.error.action") };
        failedSend = null;
        return { messageId };
      } catch (error) {
        return { error: errorMessage(error, t("channel.error.action")) };
      }
    },
  };
}

/** The dock inside the main window, when the user does not want it above the other apps. */
function WindowAgentDock(props: { serverId: string }) {
  const { sendMessage } = useConversation();
  const { selectAgent } = useNavigation();
  const channels = useChannels();
  const { openAppSettings } = useSettings();
  const dock = createServerDock(props.serverId, { readWhenHidden: false });
  const voice = createAgentDockVoice(() => props.serverId);

  return (
    <AgentDock
      seats={dock.seats()}
      available={dock.available()}
      availableChannels={dock.availableChannels()}
      chat={dock.chat}
      onOpenChange={dock.openChat}
      onAdd={dock.add}
      onRemove={dock.remove}
      onSend={(seat, text) =>
        seat.kind === "channel"
          ? dock.sendToChannel(seat.id, text)
          : sendMessage(text, [], null, { agentId: seat.id, serverId: props.serverId })
      }
      onOpenInMain={(seat) => (seat.kind === "channel" ? void channels.open(seat.id) : selectAgent(seat.id))}
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
  const { selectAgent } = useNavigation();
  const channels = useChannels();
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
        .map(
          (seat): AgentDockSeat =>
            seat.kind === "agent"
              ? { kind: "agent", agent: dockAgent(seat.agent), mood: seat.mood, state: dockSeatState(seat.state) }
              : { kind: "channel", channel: plainChannel(seat.channel), state: dockSeatState(seat.state) },
        ),
      available: dock.available().slice(0, INPUT_LIMITS.agents).map(dockAgent),
      availableChannels: dock.availableChannels().slice(0, AGENT_DOCK_LIMITS.channels).map(plainChannel),
      agents: dock.agents().slice(0, INPUT_LIMITS.agents).map(dockAgent),
      chats: openChats(dock.openSeat(), dock.chat, (seat) =>
        seat.kind === "channel" ? dock.channelMessages() : dock.agentMessages(seat.id),
      ),
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
          dock.openChat(action.seat);
          return;
        case "add":
          dock.add(action.seat);
          return;
        case "remove":
          dock.remove(action.seat);
          return;
        case "open-agent":
          selectAgent(action.agentId);
          return;
        case "open-channel":
          void channels.open(action.channelId);
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

/** The channel fields of a seat. The members are kept in channel order. */
function dockChannel(channel: ChannelSummary): AgentDockUiChannel {
  return {
    id: channel.id,
    name: channel.name,
    title: channel.title,
    members: channel.members,
    icon: channel.icon ?? null,
    imageUrl: channel.imageUrl ?? null,
  };
}

/** A plain copy of a channel for the dock window, in the bounds of the presentation. */
function plainChannel(channel: AgentDockUiChannel): AgentDockChannel {
  return {
    id: channel.id,
    name: channel.name.slice(0, INPUT_LIMITS.agentName),
    title: channel.title.slice(0, INPUT_LIMITS.agentTitle),
    members: channel.members.slice(0, INPUT_LIMITS.agents).map((member) => member.agentId),
    icon: channel.icon ? { ...channel.icon } : null,
    imageUrl:
      channel.imageUrl && channel.imageUrl.length <= AGENT_DOCK_LIMITS.channelImageUrl ? channel.imageUrl : null,
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
  seat: AgentDockSeatRef | null,
  chat: (seat: AgentDockSeatRef) => AgentDockChatModel,
  messages: (seat: AgentDockSeatRef) => readonly AgentMessage[],
): AgentDockChat[] {
  if (!seat) return [];
  const model = chat(seat);
  return [
    {
      seat: { kind: seat.kind, id: seat.id },
      messages: messages(seat).filter(isDockMessage).slice(-AGENT_DOCK_LIMITS.messages).map(dockMessage),
      working: model.working,
      wait: model.wait,
    },
  ];
}

function dockMessage(message: AgentMessage): AgentDockMessage {
  return {
    id: message.id.slice(0, INPUT_LIMITS.identifier),
    author: message.author,
    senderAgentId: message.senderAgentId ? message.senderAgentId.slice(0, INPUT_LIMITS.identifier) : null,
    senderMember: message.senderMember ? { id: message.senderMember.id, name: message.senderMember.name } : null,
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
