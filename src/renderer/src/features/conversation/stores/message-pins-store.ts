import type { PinnedMessage, PinnedMessagesSnapshot } from "@openbot/contracts/ipc";
import { formatChatTimestamp } from "@openbot/ui/features/conversation/chat-timestamp";
import type { PinnedMessageItem } from "@openbot/ui/features/conversation/PinnedMessages";
import { teamMemberName } from "@openbot/ui/features/team/TeamPersonAvatar";
import { currentText } from "@openbot/ui/text";
import { createEffect, createStore } from "solid-js";
import { actionToast } from "../../../action-toast";
import type { ConversationMessagePins, ConversationProps } from "../conversation-types";

export interface MessagePinsStoreDeps {
  props: ConversationProps;
}

/** A pin's key in the list. A branch copies messages with their ids, so the key also names the chat. */
const pinKey = (pin: PinnedMessage) => `${pin.taskId ?? ""}\n${pin.messageId}`;

/**
 * The pinned messages of the agent in view: one list for its own chat and all its side threads, so the
 * header also finds a pin of another thread. The host is the source of truth: a pin or unpin gives back
 * the new list, and the host's `message-pins-changed` event reads it again, also after a pin of the agent.
 * A host that cannot pin has no `messagePins` prop, so the pin button and the menu item do not show.
 */
export function createMessagePinsStore(deps: MessagePinsStoreDeps) {
  const [lists, setLists] = createStore<Record<string, PinnedMessage[]>>({});
  const api = () => (deps.props.channel ? undefined : deps.props.messagePins);
  const available = () => api() !== undefined && deps.props.agent !== undefined;
  // The newest request of each agent. An older answer that comes in later does not replace a newer list.
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

  /** Reads the list of an agent. A read that fails keeps the list that the view has. */
  function read(agentId: string, source: ConversationMessagePins): void {
    const current = request(agentId);
    void source
      .list(agentId)
      .then((snapshot) => {
        if (current()) apply(snapshot);
      })
      .catch(() => undefined);
  }

  /** Reads the list of the agent in view. */
  function load(): void {
    const agentId = deps.props.agent?.id;
    const source = api();
    if (agentId && source) read(agentId, source);
  }

  /** Pin or Unpin on a message of the agent's own chat (`taskId` undefined) or of a side thread. */
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
        // The list can be old, for example after a delete of the message.
        load();
      });
  }

  const pins = (): readonly PinnedMessage[] => {
    const agentId = deps.props.agent?.id;
    return (agentId && lists[agentId]) || [];
  };
  const isPinned = (taskId: string | undefined, messageId: string) =>
    pins().some((pin) => pin.messageId === messageId && pin.taskId === (taskId ?? null));
  /** The pin of a list item, while the list has it. */
  const pin = (key: string) => pins().find((candidate) => pinKey(candidate) === key);

  // The list of the agent in view, and again each time the host says that one of its pins changed.
  createEffect(
    () => ({ agentId: deps.props.agent?.id, pins: available() ? api() : undefined }),
    ({ agentId, pins: source }) => {
      if (!agentId || !source) return;
      read(agentId, source);
      return source.subscribe(agentId, () => read(agentId, source));
    },
  );

  /** A person as the chat names them: "You" for this reader. */
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

  /** Who wrote the pinned message, as the chat names its authors. */
  const authorName = (pin: PinnedMessage) =>
    pin.author === "user"
      ? (personName(pin.sender) ?? currentText().t("chat.message.you"))
      : agentName(pin.senderAgentId);

  /** Who pinned the message. Null when this reader pinned it. */
  const pinnerName = ({ pinnedBy }: PinnedMessage) =>
    pinnedBy.kind === "agent" ? agentName(pinnedBy.agentId) : personName(pinnedBy.sender);

  /** The chat of a pin outside the chat in view: "Main chat", or the title of the side thread. */
  function threadName(pin: PinnedMessage, viewTaskId: string | undefined): string | null {
    if (pin.taskId === (viewTaskId ?? null)) return null;
    const { t } = currentText();
    return pin.taskId === null ? t("chat.pins.mainChat") : pin.threadTitle || t("chat.pins.thread");
  }

  /** The pins as the list in the header shows them: the pins of the chat in view first. */
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
