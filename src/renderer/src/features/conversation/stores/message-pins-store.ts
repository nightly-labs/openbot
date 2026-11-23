import type { PinnedMessage, PinnedMessagesSnapshot } from "@openbot/contracts/ipc";
import { formatChatTimestamp } from "@openbot/ui/features/conversation/chat-timestamp";
import type { PinnedMessageItem } from "@openbot/ui/features/conversation/PinnedMessages";
import { teamMemberName } from "@openbot/ui/features/team/TeamPersonAvatar";
import { currentText } from "@openbot/ui/text";
import { createEffect, createMemo, createStore } from "solid-js";
import { actionToast } from "../../../action-toast";
import type { ConversationMessagePins, ConversationProps } from "../conversation-types";

export interface MessagePinsStoreDeps {
  props: ConversationProps;
}

const pinKey = (pin: PinnedMessage) => `${pin.taskId ?? ""}\n${pin.messageId}`;

export function createMessagePinsStore(deps: MessagePinsStoreDeps) {
  const [lists, setLists] = createStore<Record<string, PinnedMessage[]>>({});
  const api = () => (deps.props.channel ? undefined : deps.props.messagePins);
  const available = () => api() !== undefined && deps.props.agent !== undefined;
  const requests = new Map<string, number>();
  const request = (agentId: string) => {
    const next = (requests.get(agentId) ?? 0) + 1;
    requests.set(agentId, next);
    return () => requests.get(agentId) === next;
  };
  const apply = (snapshot: PinnedMessagesSnapshot) =>
    setLists((draft) => {
      draft[snapshot.agentId] = snapshot.pins;
    });

  function read(agentId: string, source: ConversationMessagePins): void {
    const current = request(agentId);
    void source
      .list(agentId)
      .then((snapshot) => {
        if (current()) apply(snapshot);
      })
      .catch(() => undefined);
  }

  function load(): void {
    const agentId = deps.props.agent?.id;
    const source = api();
    if (agentId && source) read(agentId, source);
  }

  function set(taskId: string | undefined, messageId: string, pinned: boolean): void {
    const agentId = deps.props.agent?.id;
    const pins = api();
    if (!agentId || !pins) return;
    const current = request(agentId);
    void pins
      .set(taskId === undefined ? { agentId, messageId, pinned } : { agentId, taskId, messageId, pinned })
      .then((snapshot) => {
        if (current()) apply(snapshot);
      })
      .catch((error: unknown) => {
        const { t, errorMessage } = currentText();
        actionToast.error(errorMessage(error, t("chat.pins.failed")));
        load();
      });
  }

  const pins = (): readonly PinnedMessage[] => {
    const agentId = deps.props.agent?.id;
    return (agentId && lists[agentId]) || [];
  };
  const isPinned = (taskId: string | undefined, messageId: string) =>
    pins().some((pin) => pin.messageId === messageId && pin.taskId === (taskId ?? null));
  const pin = (key: string) => pins().find((candidate) => pinKey(candidate) === key);

  const viewedAgentId = createMemo(() => deps.props.agent?.id);
  const source = createMemo(() => (available() ? api() : undefined));
  createEffect(
    () => ({ agentId: viewedAgentId(), pins: source() }),
    ({ agentId, pins: source }) => {
      if (!agentId || !source) return;
      read(agentId, source);
      return source.subscribe(agentId, () => read(agentId, source));
    },
  );

  function personName(sender: PinnedMessage["sender"]): string | null {
    const { t } = currentText();
    if (!sender || deps.props.isOwnSender(sender.id)) return null;
    const member = deps.props.presence.members.find((candidate) => candidate.id === sender.id);
    return (member ? teamMemberName(member) : sender.name.trim()) || t("chat.message.memberFallback");
  }

  const agentName = (agentId: string | null) => {
    const agent = agentId ? deps.props.agents.find((candidate) => candidate.id === agentId) : deps.props.agent;
    return agent?.name ?? currentText().t("chat.message.agentFallback");
  };

  const authorName = (pin: PinnedMessage) =>
    pin.author === "user"
      ? (personName(pin.sender) ?? currentText().t("chat.message.you"))
      : agentName(pin.senderAgentId);

  const pinnerName = ({ pinnedBy }: PinnedMessage) =>
    pinnedBy.kind === "agent" ? agentName(pinnedBy.agentId) : personName(pinnedBy.sender);

  function threadName(pin: PinnedMessage, viewTaskId: string | undefined): string | null {
    if (pin.taskId === (viewTaskId ?? null)) return null;
    const { t } = currentText();
    return pin.taskId === null ? t("chat.pins.mainChat") : pin.threadTitle || t("chat.pins.thread");
  }

  const items = (viewTaskId: string | undefined): PinnedMessageItem[] => {
    const here = (entry: PinnedMessage) => entry.taskId === (viewTaskId ?? null);
    return [...pins().filter(here), ...pins().filter((entry) => !here(entry))].map((entry) => ({
      id: pinKey(entry),
      author: authorName(entry),
      time: formatChatTimestamp(new Date(entry.createdAt)),
      body: entry.text,
      thread: threadName(entry, viewTaskId),
      pinnedBy: pinnerName(entry),
    }));
  };

  return { available, load, set, isPinned, pin, items };
}
