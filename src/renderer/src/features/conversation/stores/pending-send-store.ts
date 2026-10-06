import type { AgentMessage } from "@openbot/ui/data";
import { currentText } from "@openbot/ui/text";
import { createStore } from "solid-js";
import { formatMessageTime } from "../../../app-message-projection";
import { composerDraftKey } from "../conversation-keys";
import type { ComposerDraft, ConversationTarget, SendMessageResult } from "../conversation-types";

/** A pending row's id. The row has no message actions: the host never stored this id. */
export const PENDING_SEND_ID_PREFIX = "pending:";

/**
 * `waiting` stands behind an earlier send of the same chat that has not finished, or failed: the
 * host stores messages in the order it receives them, so a later one never overtakes.
 */
type PendingSendState = "waiting" | "sending" | "failed" | "sent";

export interface PendingSend {
  clientMessageId: string;
  /** What the composer held, for Edit. */
  draft: ComposerDraft;
  /** The text sent, with mentions expanded. */
  text: string;
  createdAt: string;
  state: PendingSendState;
  /** The host's id for the message, once it answered. The pending row stays until that row is drawn. */
  messageId: string | null;
  error: string | null;
  /** The host drops a second send with the same `clientMessageId`, so Retry cannot store it twice. */
  retrySafe: boolean;
}

export type DeliverPendingSend = (send: PendingSend) => Promise<SendMessageResult>;

/**
 * How long Retry stays safe. The host answers a repeated `clientMessageId` for a day after it stored
 * the message; half of that leaves room for a client clock that differs from the host's.
 */
const RETRY_WINDOW_MS = 12 * 60 * 60 * 1000;

/** Whether Retry cannot store the message twice: the host drops a repeat, and its window is still open. */
export function pendingSendRetrySafe(send: PendingSend, now = Date.now()): boolean {
  return send.retrySafe && now - Date.parse(send.createdAt) < RETRY_WINDOW_MS;
}

/**
 * Messages the user sent that the host has not drawn yet, per chat (`composerDraftKey`). They live
 * in memory only: after a reload the host transcript is the truth.
 */
export function createPendingSendStore() {
  // The sends themselves. A store write shows on the next flush, and the next send must start from
  // the queue as it is now, so the logic reads this map and the store only draws a copy of it.
  const queues = new Map<string, PendingSend[]>();
  const [sends, setSends] = createStore<Record<string, PendingSend[]>>({});
  // The send function of each pending message, kept for Retry.
  const deliverers = new Map<string, DeliverPendingSend>();

  function publish(key: string): void {
    const queue = (queues.get(key) ?? []).map((send) => ({ ...send }));
    setSends((current) => {
      current[key] = queue;
    });
  }

  const find = (key: string, clientMessageId: string) =>
    queues.get(key)?.find((send) => send.clientMessageId === clientMessageId);

  /** Starts the oldest waiting send of a chat, unless one is in flight or a failure stands before it. */
  function pump(key: string): void {
    const queue = queues.get(key) ?? [];
    if (queue.some((send) => send.state === "sending")) return;
    const next = queue.find((send) => send.state !== "sent");
    const deliver = next ? deliverers.get(next.clientMessageId) : undefined;
    if (next?.state !== "waiting" || !deliver) return;
    next.state = "sending";
    next.error = null;
    publish(key);
    void deliver({ ...next })
      .catch((error: unknown) => {
        const { t, errorMessage } = currentText();
        return { error: errorMessage(error, t("chat.send.failed")) };
      })
      .then((result) => {
        // Dismissed while in flight: nothing is left to update.
        if (find(key, next.clientMessageId) !== next) return;
        if ("messageId" in result) {
          deliverers.delete(next.clientMessageId);
          next.state = "sent";
          next.messageId = result.messageId;
        } else {
          next.state = "failed";
          next.error = result.error;
        }
        publish(key);
        pump(key);
      });
  }

  function add(
    target: ConversationTarget,
    input: Pick<PendingSend, "draft" | "text" | "retrySafe">,
    deliver: DeliverPendingSend,
  ): void {
    const key = composerDraftKey(target);
    const send: PendingSend = {
      ...input,
      clientMessageId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      state: "waiting",
      messageId: null,
      error: null,
    };
    deliverers.set(send.clientMessageId, deliver);
    queues.set(key, [...(queues.get(key) ?? []), send]);
    publish(key);
    pump(key);
  }

  function retry(target: ConversationTarget, clientMessageId: string): void {
    const key = composerDraftKey(target);
    const send = find(key, clientMessageId);
    if (send?.state !== "failed" || !send.retrySafe) return;
    if (!pendingSendRetrySafe(send)) {
      // The host may have forgotten the id, so the row asks the user to check the chat instead.
      send.retrySafe = false;
      publish(key);
      return;
    }
    send.state = "waiting";
    send.error = null;
    publish(key);
    pump(key);
  }

  /** Drops a failed send, for Edit or Dismiss, and lets the sends behind it go. */
  function remove(target: ConversationTarget, clientMessageId: string): PendingSend | undefined {
    const key = composerDraftKey(target);
    const send = find(key, clientMessageId);
    if (send?.state !== "failed") return undefined;
    deliverers.delete(clientMessageId);
    queues.set(
      key,
      (queues.get(key) ?? []).filter((item) => item !== send),
    );
    publish(key);
    pump(key);
    return send;
  }

  /** Drops the sent rows whose host message is now drawn, in the transcript or the queue panel. */
  function settle(target: ConversationTarget, drawnIds: ReadonlySet<string>): void {
    const key = composerDraftKey(target);
    const queue = queues.get(key) ?? [];
    const drawn = (send: PendingSend) =>
      send.state === "sent" && send.messageId !== null && drawnIds.has(send.messageId);
    if (!queue.some(drawn)) return;
    queues.set(
      key,
      queue.filter((send) => !drawn(send)),
    );
    publish(key);
  }

  /** The composer text of each send the host has not confirmed, per chat, oldest first. */
  function unsentTexts(): Record<string, string[]> {
    return Object.fromEntries(
      Object.entries(sends).flatMap(([key, queue]) => {
        const texts = queue.filter((send) => send.state !== "sent").map((send) => send.draft.text);
        return texts.length ? [[key, texts]] : [];
      }),
    );
  }

  return {
    list: (target: ConversationTarget | undefined): readonly PendingSend[] =>
      target ? (sends[composerDraftKey(target)] ?? []) : [],
    unsentTexts,
    add,
    retry,
    remove,
    settle,
  };
}

export type PendingSendStore = ReturnType<typeof createPendingSendStore>;

/** The row a pending send draws in the timeline, until the host's own row replaces it. */
export function pendingSendMessage(send: PendingSend): AgentMessage {
  return {
    id: `${PENDING_SEND_ID_PREFIX}${send.clientMessageId}`,
    author: "you",
    body: send.text,
    time: formatMessageTime(send.createdAt),
    createdAt: send.createdAt,
    replyToMessageId: send.draft.replyToMessageId,
    attachments: send.draft.attachments,
  };
}
