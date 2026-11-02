/*
 * The open channel as the props of the conversation view. The desktop and the browser client build
 * the view from the same channel store; each gives the reader, the waiting requests and the routine
 * host from its own contexts.
 */

import { leadingAddress } from "@openbot/contracts/chat-tag-references";
import type { AgentApproval, AgentEvent, BrowserTakeoverRequest } from "@openbot/contracts/ipc";
import type { AgentMessage } from "@openbot/ui/data";
import { unloadedHistory } from "@openbot/ui/features/conversation/ChatScrollRail";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo } from "solid-js";
import { agentMessagesEqual } from "../../app-message-projection";
import { channelAwaitingReplies } from "../../awaiting-replies";
import type {
  AgentSettingsRequest,
  ConversationChannelSource,
  PromptAnswerOptions,
  SendMessageResult,
} from "../conversation/conversation-types";
import {
  ChannelAboveComposer,
  ChannelEmptyState,
  ChannelHeaderTitle,
  type ChannelRoutineHost,
  ChannelSettingsPane,
} from "./ChannelConversationParts";
import {
  activeChannelRuns,
  channelApproval,
  channelBrowserTakeover,
  channelConversationRows,
  channelMessageHasContent,
  channelWorkers,
  channelWorkingTurns,
  firstUnreadChannelMessageId,
  sentChannelMessageId,
  waitingChannelPrompt,
} from "./channel-conversation-rows";
import { useChannels } from "./channels-context";

export interface ChannelConversationEnvironment {
  channelId: string;
  /** Is the stamped sender of a message the reader? */
  isOwnSender: (senderId: string) => boolean;
  /** Whether the host answers. Until it does, no command goes to it. */
  connectionReady: () => boolean;
  routines: ChannelRoutineHost;
  /** Every approval that waits on the host. The channel shows the ones of its own work. */
  approvals: () => readonly AgentApproval[];
  /** Every browser takeover that waits on the host. */
  takeovers: () => readonly BrowserTakeoverRequest[];
  /** The agents that a user hid on the host. */
  hiddenAgentIds: () => ReadonlySet<string>;
}

/** Must run inside the view that shows the channel: it reads the channel store and the interface text. */
export function createChannelConversation(env: ChannelConversationEnvironment) {
  const channels = useChannels();
  const { t, errorMessage } = useText();
  const channelId = env.channelId;
  const page = () => {
    const current = channels.state.page;
    return current?.channel.id === channelId ? current : null;
  };
  const summary = () => channels.state.channels.find((channel) => channel.id === channelId);
  const threads = () => summary()?.threads;
  const readOnly = () => page()?.channel.archived === true;
  const agentName = (agentId: string | null | undefined) => {
    const agent = channels.agents().find((candidate) => candidate.id === agentId);
    const authored = page()?.messages.find((entry) => entry.author.id === agentId);
    return agent?.name ?? authored?.author.name ?? t("chat.message.agentFallback");
  };

  const entries = createMemo(() => page()?.messages.filter(channelMessageHasContent) ?? []);

  /*
   * A row keeps its object while it does not change, so a streamed chunk draws one row again and not
   * the whole transcript.
   */
  let rowsById = new Map<string, AgentMessage>();
  const messages = createMemo((): AgentMessage[] => {
    const current = page();
    if (!current) return [];
    const next = new Map<string, AgentMessage>();
    const rows = channelConversationRows(entries()).map((mapped) => {
      const known = rowsById.get(mapped.id);
      const row = known && agentMessagesEqual(known, mapped) ? known : mapped;
      next.set(row.id, row);
      return row;
    });
    rowsById = next;
    return rows;
  });
  const unreadCount = () => summary()?.unreadCount ?? 0;
  const stoppedTurns = new Set<string>();
  const workingTurns = createMemo(() => {
    const current = page();
    return current ? channelWorkingTurns(current, stoppedTurns) : [];
  });

  const waiting = createMemo(() => {
    const current = page();
    return current ? waitingChannelPrompt(current) : null;
  });
  const prompt = createMemo((): Extract<AgentEvent, { type: "prompt" }> | undefined => {
    const found = waiting();
    if (!found) return undefined;
    const agentId = found.entry.author.id;
    return {
      type: "prompt",
      requestId: found.prompt.requestId,
      agentId,
      threadId: threads()?.find((thread) => thread.agentId === agentId)?.threadId ?? "",
      turnId: found.entry.message.turnId ?? "",
      questions: found.prompt.questions,
    };
  });
  const approval = createMemo(() => {
    const current = page();
    return current ? channelApproval(current, threads(), env.approvals()) : undefined;
  });
  const browserTakeover = createMemo(() => {
    const current = page();
    return current ? channelBrowserTakeover(current, threads(), env.takeovers()) : undefined;
  });
  const activeRuns = createMemo(() => {
    const current = page();
    return current ? activeChannelRuns(current) : [];
  });

  /*
   * Sidebar Edit and the schedule open the settings through the store. The view opens its pane once
   * for each request, so the store request is taken and cleared.
   */
  let settingsNonce = 0;
  const settingsRequest = createMemo<AgentSettingsRequest | null>((previous) => {
    if (channels.state.editing !== "settings" || channels.state.selectedId !== channelId) return previous ?? null;
    settingsNonce += 1;
    return { agentId: channelId, nonce: settingsNonce };
  });
  createEffect(
    () => channels.state.editing === "settings" && channels.state.selectedId === channelId,
    (requested) => {
      if (requested) channels.closeEditor();
    },
  );

  /**
   * The id of the stored message is read from the page after the send. A failure throws to the
   * view, which keeps the message as not sent; its Retry sends the same operation id again.
   */
  async function sendMessage(
    body: string,
    attachmentDraftIds: string[],
    replyToMessageId: string | null,
    _target?: unknown,
    clientMessageId?: string,
  ): Promise<SendMessageResult> {
    if (!env.connectionReady() || readOnly()) return { error: t("channel.error.action") };
    const sequenceBefore = page()?.throughSequence ?? 0;
    // A request that opens with a member is addressed to that member, the way a reader writes it. A
    // mention later in the text is a reference that the owner of the work can see. The host reads
    // every opening mention from the text; the field names the first one for a host that reads one.
    const mention = leadingAddress(body).mentions[0];
    try {
      const after = await channels.send({
        type: "send",
        operationId: clientMessageId ?? crypto.randomUUID(),
        channelId,
        text: body,
        recipientAgentId: mention?.id ?? null,
        replyToMessageId,
        attachmentDraftIds,
      });
      const messageId = sentChannelMessageId(after, sequenceBefore, body, env.isOwnSender);
      return messageId ? { messageId } : { error: t("channel.error.action") };
    } catch (error) {
      return { error: errorMessage(error, t("channel.error.action")) };
    }
  }

  /** An answer that fails goes to the card that shows it, when it has one. */
  async function respond(action: () => Promise<void>, options?: PromptAnswerOptions): Promise<boolean> {
    if (!env.connectionReady() || readOnly()) return false;
    let failed = false;
    const done = await channels.perform(async () => {
      try {
        await action();
      } catch (error) {
        if (!options?.onError) throw error;
        failed = true;
        options.onError(error);
      }
    });
    return done && !failed;
  }

  /**
   * One stop at a time, and none after the first that fails: the controller keeps one failed command
   * for its retry, and a later stop that succeeds would clear the error of the one that failed.
   */
  async function stopWork() {
    if (!env.connectionReady()) return;
    for (const taskId of activeRuns()) {
      const stopped = await channels.command({
        type: "stop",
        operationId: crypto.randomUUID(),
        channelId,
        taskId,
        recipientAgentId: null,
      });
      if (!stopped) return;
    }
  }

  const source: ConversationChannelSource = {
    id: channelId,
    name: () => page()?.channel.name ?? summary()?.name ?? "",
    readOnly,
    author: (message) => {
      const id = message.senderAgentId ?? "";
      return {
        kind: "agent",
        name: agentName(id),
        agent: channels.agents().find((candidate) => candidate.id === id),
        avatarSeed: id,
      };
    },
    workers: () => {
      const current = page();
      return current
        ? channelWorkers(current, channels.agents(), t("chat.activity.agentFallback"), env.hiddenAgentIds())
        : [];
    },
    workingTurns,
    interactionAgentName: () => {
      const agentId = approval()?.agentId ?? browserTakeover()?.agentId ?? prompt()?.agentId;
      return agentId ? agentName(agentId) : undefined;
    },
    awaitingReplies: () => {
      const current = page();
      if (!current || current.channel.archived) return [];
      return channelAwaitingReplies({
        tasks: current.tasks,
        agents: channels.agents(),
        name: (id) => (id ? agentName(id) : t("sidebar.section.unassigned")),
      });
    },
    HeaderTitle: (props) => <ChannelHeaderTitle channelId={channelId} onOpenSettings={props.onOpenSettings} />,
    SettingsPane: (props) => (
      <ChannelSettingsPane
        channelId={channelId}
        routines={env.routines}
        maxWidth={props.maxWidth}
        onWidthChange={props.onWidthChange}
        onClose={props.onClose}
      />
    ),
    AboveComposer: () => <ChannelAboveComposer channelId={channelId} />,
    EmptyState: () => <ChannelEmptyState channelId={channelId} />,
  };

  return {
    source,
    loaded: () => page() !== null,
    messages,
    unreadCount,
    firstUnreadMessageId: () => firstUnreadChannelMessageId(entries(), unreadCount(), env.isOwnSender),
    hasOlder: () => Boolean(page()?.olderCursor),
    unloadedHistory: () => unloadedHistory(page()),
    /** The agents that a mention can name: the members. A hidden agent gets no work here either. */
    mentionAgents: () => {
      const members = new Set(page()?.channel.members.map((member) => member.agentId));
      return channels.agents().filter((agent) => members.has(agent.id));
    },
    activeTurnId: () => activeRuns()[0] ?? null,
    prompt,
    promptUiBlock: () => waiting()?.entry.message.uiBlock,
    approval,
    browserTakeover,
    settingsRequest,
    onSendMessage: sendMessage,
    onMarkRead: async () => {
      const current = page();
      if (!current || !env.connectionReady()) return;
      await channels.command({
        type: "read",
        channelId,
        throughSequence: current.throughSequence,
        operationId: crypto.randomUUID(),
      });
    },
    onLoadOlder: () => void channels.loadOlder(),
    onAnswerPrompt: (answers: Record<string, string[]>, options?: PromptAnswerOptions) => {
      const requestId = waiting()?.prompt.requestId;
      if (requestId === undefined) return Promise.resolve(false);
      return respond(() => channels.port().agent.respondToPrompt({ requestId, answers }), options);
    },
    onRespondToApproval: (decision: "accept" | "decline") => {
      const requestId = approval()?.requestId;
      if (requestId === undefined) return Promise.resolve(false);
      return respond(() => channels.port().agent.respondToApproval({ requestId, decision }));
    },
    onRespondToBrowserTakeover: (decision: "complete" | "cancel") => {
      const requestId = browserTakeover()?.requestId;
      if (requestId === undefined) return Promise.resolve(false);
      return respond(() => channels.port().agent.respondToBrowserTakeover({ requestId, decision }));
    },
    onStop: () => void stopWork(),
  };
}
