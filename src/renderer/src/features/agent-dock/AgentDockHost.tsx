import type { AgentProviderRef } from "@openbot/contracts/agent-providers";
import { leadingAddress } from "@openbot/contracts/chat-tag-references";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AGENT_DOCK_LIMITS,
  type AgentApproval,
  type AgentDockAgent,
  type AgentDockApproval,
  type AgentDockBackupModel,
  type AgentDockChannel,
  type AgentDockChat,
  type AgentDockMessage,
  type AgentDockPresentation,
  type AgentDockPrompt,
  type AgentDockResult,
  type AgentDockSeat,
  type AgentDockSeatRef,
  type AgentDockSeatState,
  type AgentDockTakeover,
  type AgentDockTakeoverPage,
  type AgentDockUsageLimit,
  type ChannelPage,
  type ChannelSummary,
  isAttachmentSummary,
  LOCAL_SERVER_ID,
  sameAgentModelChoice,
  withOpenBotSource,
} from "@openbot/contracts/ipc";
import { approvalIsCut } from "@openbot/team-client/runtime-attention";
import type { AgentMessage, ComposerAgent } from "@openbot/ui/data";
import {
  AgentDock,
  type AgentDockChatAnswers,
  type AgentDockChatModel,
  type AgentDockSendResult,
  type AgentDockChannel as AgentDockUiChannel,
  type AgentDockSeat as AgentDockUiSeat,
  agentDockSeatKey,
} from "@openbot/ui/features/agent-dock/AgentDock";
import { isDockMessage, isDockVisualReply } from "@openbot/ui/features/agent-dock/AgentDockChat";
import type { UsageLimitAskCardProps } from "@openbot/ui/features/conversation/BackupModels";
import { markdownPlainText } from "@openbot/ui/features/conversation/MarkdownMessageText";
import { sidebarAgentOrder } from "@openbot/ui/features/sidebar/sidebar-agent-order";
import { sidebarChannelWaits, sidebarUnreadBadge } from "@openbot/ui/features/sidebar/sidebar-agent-states";
import type { SidebarAgentState } from "@openbot/ui/features/sidebar/sidebar-types";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, Match, onCleanup, onSettled, Show, Switch, untrack } from "solid-js";
import { appPort } from "../../app-port";
import { useNavigation } from "../../navigation";
import { usePlatform } from "../../platform";
import { useTurns } from "../../turns";
import { useAuth } from "../account/account-context";
import { useAgentTasks } from "../agent-tasks/agent-tasks-context";
import { createAgentActivity } from "../agents/agent-activity";
import { attentionKey } from "../agents/agent-runtime-snapshot";
import { useAgents } from "../agents/agents-context";
import { useBrowserTabs } from "../browser/browser-context";
import {
  channelConversationRows,
  channelMessageHasContent,
  channelWorkingTurns,
  sentChannelMessageId,
} from "../channels/channel-conversation-rows";
import { useChannels } from "../channels/channels-context";
import { browserSecretVault } from "../conversation/browser-secret-vault";
import { useConversation } from "../conversation/conversation-context";
import { latestVisibleAgentMessageId } from "../conversation/conversation-read-state";
import { createAgentMessageDeleteAccess, desktopAgentMessageDeleteAccess } from "../conversation/message-delete-access";
import { narrationRows, placeTurnRowsByTime } from "../conversation/narration-rows";
import { usageLimitAskFrom } from "../conversation/usage-limit-ask";
import { serverSupportsCapability } from "../servers/server-capabilities";
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
  setAgentDockPreference,
  setAgentDockSeats,
  useAgentDockPreference,
} from "./agent-dock-preference";
import { createAgentDockVoice } from "./agent-dock-voice";

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

export function AgentDockHost() {
  const { activeServerId } = useServers();
  const placement = useAgentDockPlacement();
  const platform = usePlatform();
  const preference = useAgentDockPreference();

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

function createServerDock(serverId: string, options: { readWhenHidden: boolean }) {
  const { activeAgentId, agentList, userHiddenAgentIds, agentStatus, modelOptions, updateAgent, appendUiError } =
    useAgents();
  const { conversations, markAgentMessagesRead, loadLatestAgentMessages, clearRecentReply, presentPromptResolution } =
    useConversation();
  const { workingTurns, agentStates, agentMoods } = createAgentActivity();
  const agentTasks = useAgentTasks();
  const { sidebarLayout, pinnedSidebarItems } = useSidebar();
  const channels = useChannels();
  const {
    approvals,
    pendingPrompts,
    respondToApprovalRequest,
    answerPromptRequest,
    respondToBrowserTakeoverRequest,
    queues,
    usageLimits,
    usageLimitedModels,
    waitedUsageLimits,
    setWaitedUsageLimits,
  } = useTurns();
  const { readerMemberId } = usePresence();
  const auth = useAuth();
  const { activeServer } = useServers();
  const { browserTabs } = useBrowserTabs();
  const { t, errorMessage, sourceText } = useText();
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
  let failedSend: { channelId: string; text: string; operationId: string } | null = null;

  const saveSeats = (seats: readonly AgentDockSeatRef[]) => setAgentDockSeats(serverId, seats);
  const seated = (seat: AgentDockSeatRef) => seatRefs().some((item) => item.kind === seat.kind && item.id === seat.id);

  const shownAgents = createMemo(() => agentList().filter((agent) => !userHiddenAgentIds().has(agent.id)));
  const shownChannels = createMemo(() =>
    channels.supported() ? channels.state.channels.filter((channel) => !channel.archived) : [],
  );
  const channelWaits = createMemo(() => {
    const prompts = Object.values(pendingPrompts());
    return sidebarChannelWaits({
      channels: shownChannels(),
      prompts: prompts.flatMap((event) => (event?.type === "prompt" ? [event] : [])),
      takeovers: prompts.flatMap((event) => (event?.type === "browser-takeover-requested" ? [event.request] : [])),
      approvals: approvals(),
    });
  });
  const channelState = (channel: ChannelSummary): SidebarAgentState | undefined =>
    sidebarUnreadBadge(channel.unreadCount, channelWaits()[channel.id]) ??
    (channel.activeTasks > 0 ? { kind: "working" } : undefined);
  const temporaryRefs = createMemo(
    (previous: readonly AgentDockSeatRef[] = []): AgentDockSeatRef[] => {
      if (!preference().activeSeats) return [];
      const open = openSeat();
      const savedKeys = new Set(seatRefs().map(agentDockSeatKey));
      const shows = (seat: AgentDockSeatRef, state: SidebarAgentState | undefined) =>
        !savedKeys.has(agentDockSeatKey(seat)) &&
        (callsForUser(state) || (open?.kind === seat.kind && open.id === seat.id));
      const active = [
        ...shownAgents().flatMap((agent): AgentDockSeatRef[] => {
          const seat: AgentDockSeatRef = { kind: "agent", id: agent.id };
          return shows(seat, agentStates()[agent.id]) ? [seat] : [];
        }),
        ...shownChannels().flatMap((channel): AgentDockSeatRef[] => {
          const seat: AgentDockSeatRef = { kind: "channel", id: channel.id };
          return shows(seat, channelState(channel)) ? [seat] : [];
        }),
      ];
      const activeKeys = new Set(active.map(agentDockSeatKey));
      const kept = previous.filter((seat) => activeKeys.has(agentDockSeatKey(seat)));
      const keptKeys = new Set(kept.map(agentDockSeatKey));
      const added = active.filter((seat) => !keptKeys.has(agentDockSeatKey(seat)));
      const shownKeys = new Set([
        ...shownAgents().map((agent) => agentDockSeatKey({ kind: "agent", id: agent.id })),
        ...shownChannels().map((channel) => agentDockSeatKey({ kind: "channel", id: channel.id })),
      ]);
      const savedShown = [...savedKeys].filter((key) => shownKeys.has(key)).length;
      return [...kept, ...added].slice(0, Math.max(0, AGENT_DOCK_LIMITS.seats - savedShown));
    },
    { equals: sameAgentDockSeats },
  );
  const seats = createMemo((): AgentDockUiSeat[] => {
    const agents = new Map(shownAgents().map((agent) => [agent.id, agent]));
    const channelById = new Map(shownChannels().map((channel) => [channel.id, channel]));
    const seat = (ref: AgentDockSeatRef, temporary: boolean): AgentDockUiSeat[] => {
      if (ref.kind === "agent") {
        const agent = agents.get(ref.id);
        return agent
          ? [{ kind: "agent", agent, mood: agentMoods()[ref.id] ?? "idle", state: agentStates()[ref.id], temporary }]
          : [];
      }
      const channel = channelById.get(ref.id);
      return channel
        ? [{ kind: "channel", channel: dockChannel(channel), state: channelState(channel), temporary }]
        : [];
    };
    return [...seatRefs().flatMap((ref) => seat(ref, false)), ...temporaryRefs().flatMap((ref) => seat(ref, true))];
  });
  const onDock = createMemo(() => new Set([...seatRefs(), ...temporaryRefs()].map(agentDockSeatKey)));
  const available = createMemo(() =>
    shownAgents().filter((agent) => !onDock().has(agentDockSeatKey({ kind: "agent", id: agent.id }))),
  );
  const availableChannels = createMemo(() =>
    shownChannels()
      .filter((channel) => !onDock().has(agentDockSeatKey({ kind: "channel", id: channel.id })))
      .map(dockChannel),
  );

  const isOwnSender = (senderId: string) => {
    const state = auth.centralAuth();
    return isReaderAuthor(senderId, {
      memberId: readerMemberId(),
      accountUserId: state.status === "signed_in" ? state.user.id : null,
      onOwnComputer: activeServer()?.kind === "local",
    });
  };

  const [readPage, setReadPage] = createSignal<ChannelPage | null>(null);
  const channelPage = (channelId: string): ChannelPage | null => {
    const selected = channels.state.page;
    if (selected?.channel.id === channelId) return selected;
    const read = readPage();
    return read?.channel.id === channelId ? read : null;
  };
  let readId = 0;
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

  const shownChannelId = createMemo((previous?: string | null) => openChannelId() ?? previous ?? null);
  const ownCopies = new WeakMap<AgentMessage, AgentMessage>();
  const asOwn = (message: AgentMessage): AgentMessage => {
    if (message.author !== "you" || !message.senderMember || !isOwnSender(message.senderMember.id)) return message;
    const copy = ownCopies.get(message);
    if (copy && copy.body === message.body && copy.kind === message.kind && copy.attachments === message.attachments)
      return copy;
    const { senderMember: _own, ...own } = message;
    ownCopies.set(message, own);
    return own;
  };
  const channelMessages = createMemo((): AgentMessage[] => {
    const channelId = shownChannelId();
    const page = channelId ? channelPage(channelId) : null;
    if (!page) return [];
    return withStepAnswers(
      channelConversationRows(page.messages.filter(channelMessageHasContent), page.tasks, sourceText).map(asOwn),
      new Set(channelWorkingTurns(page, new Set())),
      (row) => agentList().find((agent) => agent.id === row.senderAgentId)?.provider,
    );
  });
  const agentMessages = (agentId: string): AgentMessage[] => {
    const running = workingTurns()[agentId];
    const asking = promptOf({ kind: "agent", id: agentId })?.turnId;
    return withStepAnswers(
      (conversations[agentId]?.messages ?? []).map(asOwn),
      new Set(running && running !== asking ? [running] : []),
      () => agentList().find((agent) => agent.id === agentId)?.provider,
    );
  };

  const [failedAnswers, setFailedAnswers] = createSignal<Record<string, number>>({});
  const attemptOf = (key: string) => Math.min(failedAnswers()[key] ?? 0, AGENT_DOCK_LIMITS.count);
  const failed = (key: string) => {
    if (!disposed) setFailedAnswers((current) => ({ ...current, [key]: (current[key] ?? 0) + 1 }));
  };
  const threadsOf = (seat: AgentDockSeatRef): readonly { agentId: string; threadId: string }[] =>
    seat.kind === "agent"
      ? shownAgents().flatMap((agent) =>
          agent.id === seat.id && agent.threadId ? [{ agentId: agent.id, threadId: agent.threadId }] : [],
        )
      : (shownChannels().find((channel) => channel.id === seat.id)?.threads ?? []);
  const approvalOf = (seat: AgentDockSeatRef): AgentDockApproval | null => {
    const threads = threadsOf(seat);
    const approval = approvals().find((item) =>
      threads.some((thread) => thread.agentId === item.agentId && thread.threadId === item.threadId),
    );
    if (!approval) return null;
    return {
      approval,
      attempt: attemptOf(answerKey("approval", approval.agentId, approval.requestId)),
      cut: approvalIsCut(approval),
    };
  };
  const promptOf = (seat: AgentDockSeatRef): AgentDockPrompt | null => {
    for (const thread of threadsOf(seat)) {
      const event = pendingPrompts()[attentionKey(thread.agentId, thread.threadId)];
      if (event?.type !== "prompt" || event.questions.length === 0) continue;
      return {
        requestId: event.requestId,
        agentId: event.agentId,
        threadId: event.threadId,
        turnId: event.turnId,
        questions: event.questions.slice(0, INPUT_LIMITS.promptQuestions),
        attempt: attemptOf(answerKey("prompt", event.agentId, event.requestId)),
      };
    }
    return null;
  };
  const takeoverPage = (tabId: string): AgentDockTakeoverPage | null => {
    const tab = browserTabs().find((candidate) => candidate.id === tabId);
    if (!tab) return null;
    let origin = "";
    try {
      const parsed = new URL(tab.url).origin;
      if (parsed !== "null") origin = parsed;
    } catch {}
    return {
      title: tab.title.slice(0, AGENT_DOCK_LIMITS.pageTitle),
      origin: origin.slice(0, AGENT_DOCK_LIMITS.pageOrigin),
    };
  };
  const takeoverOf = (seat: AgentDockSeatRef): AgentDockTakeover | null => {
    for (const thread of threadsOf(seat)) {
      const event = pendingPrompts()[attentionKey(thread.agentId, thread.threadId)];
      if (event?.type !== "browser-takeover-requested") continue;
      const { request } = event;
      const name = agentList().find((agent) => agent.id === request.agentId)?.name ?? t("chat.message.agentFallback");
      const vault = request.secret ? browserSecretVault(activeServer()) : undefined;
      return {
        request,
        page: takeoverPage(request.tabId),
        agentName: name.slice(0, INPUT_LIMITS.agentName),
        vault: vault ? { ...vault, server: vault.server?.slice(0, INPUT_LIMITS.agentName) ?? null } : null,
        attempt: attemptOf(answerKey("takeover", request.agentId, request.requestId)),
      };
    }
    return null;
  };

  const deletesAnyAgentMessage = createAgentMessageDeleteAccess(desktopAgentMessageDeleteAccess(activeServer));
  const remote = () => activeServer()?.kind === "remote";
  const usageLimitAskFor = usageLimitAskFrom({
    available: (agentId) =>
      serverSupportsCapability(activeServer(), "agent-usage-limit-v1") &&
      (!remote() || deletesAnyAgentMessage(agentId)),
    rememberable: () => !remote(),
    usageLimits,
    waited: waitedUsageLimits,
    wait: (agentId, resetsAt) => setWaitedUsageLimits((current) => ({ ...current, [agentId]: resetsAt })),
    modelOptions,
    providers: () => agentStatus().providers,
    limited: (choice) => usageLimitedModels().some((held) => sameAgentModelChoice(held, choice)),
    update: async (agentId, updates) => {
      await updateAgent(agentId, updates);
    },
  });
  const usageLimitAsk = (agentId: string): UsageLimitAskCardProps | undefined => {
    if (!queues()[agentId]?.deliveries.some((delivery) => delivery.status === "queued")) return undefined;
    return usageLimitAskFor(shownAgents().find((agent) => agent.id === agentId));
  };
  const usageLimitOf = (seat: AgentDockSeatRef): AgentDockUsageLimit | null => {
    if (seat.kind !== "agent") return null;
    const ask = usageLimitAsk(seat.id);
    if (!ask) return null;
    return {
      agentId: seat.id,
      provider: ask.provider,
      model: ask.model?.slice(0, AGENT_DOCK_LIMITS.backupModelLabel) ?? null,
      agentName: ask.agentName?.slice(0, INPUT_LIMITS.agentName) ?? null,
      resetsAt: ask.resetsAt === null ? null : Math.max(0, Math.floor(ask.resetsAt)),
      options: ask.options
        .filter((option) => option.key.length > 0 && option.key.length <= AGENT_DOCK_LIMITS.backupModelKey)
        .slice(0, AGENT_DOCK_LIMITS.backupModels)
        .map(
          (option): AgentDockBackupModel => ({
            key: option.key,
            choice: { ...option.choice },
            model: option.model.slice(0, AGENT_DOCK_LIMITS.backupModelLabel),
            account: option.account?.slice(0, AGENT_DOCK_LIMITS.backupModelLabel) ?? null,
            state: option.state,
          }),
        ),
      rememberable: ask.rememberable !== false,
      attempt: attemptOf(answerKey("usage-limit", seat.id, ask.resetsAt ?? "")),
    };
  };

  const chat = (seat: AgentDockSeatRef): AgentDockChatModel => {
    if (seat.kind === "channel") {
      const summary = shownChannels().find((channel) => channel.id === seat.id);
      return {
        messages: shownChannelId() === seat.id ? channelMessages() : [],
        working: (summary?.activeTasks ?? 0) > 0,
        wait: channelWaits()[seat.id]?.reason ?? null,
        approval: approvalOf(seat),
        prompt: promptOf(seat),
        takeover: takeoverOf(seat),
        usageLimit: null,
      };
    }
    const state = agentStates()[seat.id];
    return {
      messages: agentMessages(seat.id),
      working: Boolean(workingTurns()[seat.id]),
      wait: state?.kind === "waiting" ? state.reason : null,
      approval: approvalOf(seat),
      prompt: promptOf(seat),
      takeover: takeoverOf(seat),
      usageLimit: usageLimitOf(seat),
    };
  };

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
  let connectedSequence: number | undefined;
  createEffect(
    () => {
      const server = activeServer();
      return server?.state === "online" ? server.connectionSequence : undefined;
    },
    (sequence) => {
      if (sequence === undefined || sequence === connectedSequence) return;
      const reconnected = connectedSequence !== undefined;
      connectedSequence = sequence;
      if (!reconnected) return;
      const loaded = untrack(() =>
        seats().flatMap((seat) =>
          seat.kind === "agent" && seat.agent.id !== activeAgentId() && conversations[seat.agent.id]?.messages?.length
            ? [seat.agent.id]
            : [],
        ),
      );
      for (const agentId of loaded) void loadLatestAgentMessages(agentId).catch(() => undefined);
    },
  );
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

  let firstSeen = new Map<string, number>();
  const results = createMemo((): AgentDockResult[] => {
    if (!preference().results) return [];
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
      if (seat?.kind === "agent" && !conversations[seat.id]?.messages?.length) void loadLatestAgentMessages(seat.id);
    },
    mainTabOf(agentId: string): string | undefined {
      const state = agentStates()[agentId];
      if (state?.kind !== "unread" || state.count > 0) return undefined;
      let newest: { id: string; updatedAt: string } | undefined;
      for (const task of agentTasks.snapshot(agentId)?.tasks ?? []) {
        if (agentTasks.unreadCount(task) > 0 && (!newest || task.updatedAt > newest.updatedAt)) newest = task;
      }
      return newest?.id;
    },
    add(seat: AgentDockSeatRef) {
      if (!seated(seat)) saveSeats([...seatRefs(), { kind: seat.kind, id: seat.id }]);
    },
    remove(seat: AgentDockSeatRef) {
      saveSeats(seatRefs().filter((item) => item.kind !== seat.kind || item.id !== seat.id));
    },
    move(seat: AgentDockSeatRef, before: AgentDockSeatRef | null) {
      if (!seated(seat) && !temporaryRefs().some((item) => item.kind === seat.kind && item.id === seat.id)) return;
      const others = seatRefs().filter((item) => item.kind !== seat.kind || item.id !== seat.id);
      const index = before ? others.findIndex((item) => item.kind === before.kind && item.id === before.id) : -1;
      const moved = { kind: seat.kind, id: seat.id };
      saveSeats(index < 0 ? [...others, moved] : [...others.slice(0, index), moved, ...others.slice(index)]);
    },
    async respondToApproval(
      agentId: string,
      requestId: string | number,
      decision: "accept" | "decline",
    ): Promise<boolean> {
      const done = await respondToApprovalRequest(agentId, requestId, decision);
      if (!done) failed(answerKey("approval", agentId, requestId));
      return done;
    },
    async answerPrompt(
      agentId: string,
      threadId: string | null,
      requestId: string | number,
      answers: Record<string, string[]>,
    ): Promise<boolean> {
      const event = pendingPrompts()[attentionKey(agentId, threadId)];
      const turnId = event?.type === "prompt" ? event.turnId : null;
      const done = await answerPromptRequest(agentId, threadId, requestId, answers);
      if (!done) failed(answerKey("prompt", agentId, requestId));
      else if (turnId !== null && !disposed) presentPromptResolution(agentId, turnId, requestId);
      return done;
    },
    async respondToTakeover(
      agentId: string,
      threadId: string | null,
      requestId: string | number,
      decision: "complete" | "cancel",
    ): Promise<boolean> {
      const done = await respondToBrowserTakeoverRequest(agentId, threadId, requestId, decision);
      if (!done) failed(answerKey("takeover", agentId, requestId));
      return done;
    },
    async sendOnBackup(agentId: string, optionKey: string, remember: boolean): Promise<void> {
      const ask = usageLimitAsk(agentId);
      const option = ask?.options.find((item) => item.key === optionKey);
      if (!ask || !option) throw new Error(t("chat.usageLimit.failed"));
      await ask.onSend(option, remember && ask.rememberable !== false);
    },
    waitForReset(agentId: string): void {
      usageLimitAsk(agentId)?.onWait();
    },
    failBackupSend(agentId: string, error: unknown): void {
      if (!disposed) appendUiError(agentId, error, t("chat.usageLimit.failed"), serverId);
      failed(answerKey("usage-limit", agentId, usageLimitAsk(agentId)?.resetsAt ?? ""));
    },
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

function WindowAgentDock(props: { serverId: string }) {
  const { sendMessage } = useConversation();
  const { selectAgent } = useNavigation();
  const channels = useChannels();
  const { openAppSettings } = useSettings();
  const dock = createServerDock(props.serverId, { readWhenHidden: false });
  const voice = createAgentDockVoice(() => props.serverId);
  const answers: AgentDockChatAnswers = {
    approval: (approval, decision) => dock.respondToApproval(approval.agentId, approval.requestId, decision),
    prompt: (prompt, values) => dock.answerPrompt(prompt.agentId, prompt.threadId, prompt.requestId, values),
    takeover: ({ request }, decision) =>
      dock.respondToTakeover(request.agentId, request.threadId, request.requestId, decision),
    takeoverDone: ({ request }) => props.serverId === LOCAL_SERVER_ID || request.reason !== "sign-in-blocked",
    secret: (_takeover, input) => agentDockPort().agent.respondToBrowserSecret(input, props.serverId),
    usageLimitSend: (limit, option, remember) => dock.sendOnBackup(limit.agentId, option.key, remember),
    usageLimitWait: (limit) => dock.waitForReset(limit.agentId),
  };

  return (
    <AgentDock
      seats={dock.seats()}
      available={dock.available()}
      availableChannels={dock.availableChannels()}
      chat={dock.chat}
      onOpenChange={dock.openChat}
      onAdd={dock.add}
      onRemove={dock.remove}
      onMove={dock.move}
      onSend={(seat, text) =>
        seat.kind === "channel"
          ? dock.sendToChannel(seat.id, text)
          : sendMessage(text, [], null, { agentId: seat.id, serverId: props.serverId })
      }
      onOpenInMain={(seat) =>
        seat.kind === "channel" ? void channels.open(seat.id) : selectAgent(seat.id, dock.mainTabOf(seat.id))
      }
      onOpenWindow={(agentId) => void appPort().openChatWindow({ serverId: props.serverId, agentId })}
      answers={answers}
      voice={voice}
      agents={dock.agents()}
      onSelectAgent={(agentId) => selectAgent(agentId)}
      onOpenLink={(url) => void appPort().openUrl(withOpenBotSource(url))}
      onOpenSettings={() => openAppSettings(null, "agent-dock")}
      onHide={() => setAgentDockPreference({ shown: false })}
      results={dock.results()}
    />
  );
}

function ScreenAgentDock(props: { serverId: string }) {
  const { selectAgent } = useNavigation();
  const channels = useChannels();
  const { openAppSettings } = useSettings();
  const preference = useAgentDockPreference();
  const dock = createServerDock(props.serverId, { readWhenHidden: true });

  const presentation = createMemo(
    (): AgentDockPresentation => ({
      serverId: props.serverId,
      display: { ...preference().display },
      edge: preference().edge,
      autoHide: preference().autoHide,
      edgeStrip: preference().edgeStrip,
      sizePercent: preference().sizePercent,
      offsets: preference().offsets.map((item) => ({ ...item })),
      seats: dock
        .seats()
        .slice(0, AGENT_DOCK_LIMITS.seats)
        .map(
          (seat): AgentDockSeat =>
            seat.kind === "agent"
              ? {
                  kind: "agent",
                  agent: dockAgent(seat.agent),
                  mood: seat.mood,
                  state: dockSeatState(seat.state),
                  temporary: seat.temporary === true,
                }
              : {
                  kind: "channel",
                  channel: plainChannel(seat.channel),
                  state: dockSeatState(seat.state),
                  temporary: seat.temporary === true,
                },
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
        void appPort().openUrl(withOpenBotSource(action.url));
        return;
      }
      if (action.type === "open-settings") {
        openAppSettings(null, "agent-dock");
        return;
      }
      if (action.type === "hide") {
        setAgentDockPreference({ shown: false });
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
        case "move":
          dock.move(action.seat, action.before);
          return;
        case "open-agent":
          selectAgent(action.agentId, dock.mainTabOf(action.agentId));
          return;
        case "open-channel":
          void channels.open(action.channelId);
          return;
        case "open-window":
          void appPort().openChatWindow({ serverId: action.serverId, agentId: action.agentId });
          return;
        case "respond-approval":
          void dock.respondToApproval(action.agentId, action.requestId, action.decision);
          return;
        case "answer-prompt":
          void dock.answerPrompt(action.agentId, action.threadId, action.requestId, action.answers);
          return;
        case "respond-takeover":
          void dock.respondToTakeover(action.agentId, action.threadId, action.requestId, action.decision);
          return;
        case "usage-limit-send":
          void dock
            .sendOnBackup(action.agentId, action.optionKey, action.remember)
            .catch((error: unknown) => dock.failBackupSend(action.agentId, error));
          return;
        case "usage-limit-wait":
          dock.waitForReset(action.agentId);
          return;
        case "send":
          return;
      }
    });
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
    ...(agent.chatColor === undefined ? {} : { chatColor: agent.chatColor }),
  };
}

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

function callsForUser(state: SidebarAgentState | undefined): boolean {
  return state?.kind === "waiting" || state?.kind === "unread" || state?.kind === "responded";
}

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
      approval: model.approval ? dockApproval(model.approval) : null,
      prompt: model.prompt ?? null,
      takeover: model.takeover ?? null,
      usageLimit: model.usageLimit ?? null,
    },
  ];
}

function answerKey(kind: string, agentId: string, requestId: string | number): string {
  return JSON.stringify([kind, agentId, String(requestId)]);
}

function dockApproval(current: { approval: AgentApproval; attempt: number }): AgentDockApproval {
  const { approval } = current;
  return {
    approval: {
      requestId: approval.requestId,
      agentId: approval.agentId,
      threadId: approval.threadId,
      turnId: approval.turnId,
      kind: approval.kind,
      command: approval.command,
      cwd: approval.cwd,
      reason: approval.reason,
      grantRoot: approval.grantRoot,
      permissions: approval.permissions
        ? {
            fileSystem: {
              read: [...approval.permissions.fileSystem.read],
              write: [...approval.permissions.fileSystem.write],
            },
            network: approval.permissions.network,
          }
        : null,
    },
    attempt: current.attempt,
    cut: approvalIsCut(current.approval),
  };
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
    ...(isDockVisualReply(message) ? { visual: true } : {}),
  };
}

function withStepAnswers(
  messages: readonly AgentMessage[],
  running: ReadonlySet<string>,
  provider: (row: AgentMessage) => AgentProviderRef | undefined,
): AgentMessage[] {
  const answered = new Set<string>();
  for (const message of messages)
    if (message.turnId && message.author === "agent" && isDockMessage(message)) answered.add(message.turnId);
  const notes: AgentMessage[][] = [];
  const rows = messages.flatMap((message) => {
    const turnId = message.turnId;
    if (message.kind !== "thinking" || message.streaming || !turnId || answered.has(turnId) || running.has(turnId))
      return [message];
    const note = stepNote(message, provider);
    if (!note) return [message];
    if (!note.createdAt) return [note];
    notes.push([note]);
    return [];
  });
  return notes.length > 0 ? placeTurnRowsByTime(rows, notes) : rows;
}

const stepNotes = new WeakMap<AgentMessage, { count: number; note: AgentMessage | undefined }>();
function stepNote(
  steps: AgentMessage,
  provider: (row: AgentMessage) => AgentProviderRef | undefined,
): AgentMessage | undefined {
  const count = steps.items?.length ?? 0;
  const known = stepNotes.get(steps);
  if (known?.count === count) return known.note;
  const note = narrationRows(steps, provider(steps)).at(-1);
  stepNotes.set(steps, { count, note });
  return note;
}

function unreadAnswers(messages: readonly AgentMessage[], count: number, firstUnreadId: string | null): AgentMessage[] {
  const first = firstUnreadId === null ? -1 : messages.findIndex((message) => message.id === firstUnreadId);
  const unread = first >= 0 ? messages.slice(first) : messages.slice(-count);
  return unread.filter(
    (message) => message.author === "agent" && isDockMessage(message) && message.kind !== "error" && !message.streaming,
  );
}

const RESULT_LABEL = 120;
const BLOCK_MARKER = /^(#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/;

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
