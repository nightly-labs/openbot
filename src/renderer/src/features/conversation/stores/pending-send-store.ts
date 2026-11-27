import type { AgentMessage } from "@openbot/ui/data";
import { currentText } from "@openbot/ui/text";
import { createStore } from "solid-js";
import { formatMessageTime } from "../../../app-message-projection";
import { composerDraftKey } from "../conversation-keys";
import type { ComposerDraft, ConversationTarget, SendMessageResult } from "../conversation-types";

export const PENDING_SEND_ID_PREFIX = "pending:";

type PendingSendState = "waiting" | "sending" | "failed" | "sent";

export interface PendingSend {
  clientMessageId: string;
  draft: ComposerDraft;
  text: string;
  createdAt: string;
  state: PendingSendState;
  messageId: string | null;
  error: string | null;
  errorReference: string | null;
  retrySafe: boolean;
  voiceRecordingDraftId: string | null;
  queued: boolean;
  late: boolean;
  starting: boolean;
}

export type DeliverPendingSend = (send: PendingSend) => Promise<SendMessageResult>;

const RETRY_WINDOW_MS = 12 * 60 * 60 * 1000;

const START_GRACE_MS = 3000;

const QUEUED_REVEAL_MS = 400;

export function pendingSendRetrySafe(send: PendingSend, now = Date.now()): boolean {
  return send.retrySafe && now - Date.parse(send.createdAt) < RETRY_WINDOW_MS;
}

export function createPendingSendStore() {
  const queues = new Map<string, PendingSend[]>();
  const [sends, setSends] = createStore<Record<string, PendingSend[]>>({});
  const deliverers = new Map<string, DeliverPendingSend>();

  function publish(key: string): void {
    const queue = (queues.get(key) ?? []).map((send) => ({ ...send }));
    setSends((current) => {
      current[key] = queue;
    });
  }

  const find = (key: string, clientMessageId: string) =>
    queues.get(key)?.find((send) => send.clientMessageId === clientMessageId);

  function pump(key: string): void {
    const queue = queues.get(key) ?? [];
    if (queue.some((send) => send.state === "sending")) return;
    const next = queue.find((send) => send.state !== "sent");
    const deliver = next ? deliverers.get(next.clientMessageId) : undefined;
    if (next?.state !== "waiting" || !deliver) return;
    next.state = "sending";
    next.error = null;
    next.errorReference = null;
    publish(key);
    void deliver({ ...next })
      .catch((error: unknown) => {
        const { t, errorDetails } = currentText();
        const fallback = t("chat.send.failed");
        const details = errorDetails(error, fallback);
        return { error: details.message === fallback ? null : details.message, reference: details.reference };
      })
      .then((result) => {
        if (find(key, next.clientMessageId) !== next) return;
        if ("messageId" in result) {
          deliverers.delete(next.clientMessageId);
          next.state = "sent";
          next.messageId = result.messageId;
          next.starting = !next.queued;
          if (next.starting)
            window.setTimeout(() => {
              if (find(key, next.clientMessageId) !== next) return;
              next.starting = false;
              publish(key);
            }, START_GRACE_MS);
        } else {
          next.state = "failed";
          next.error = result.error;
          next.errorReference = result.reference ?? null;
        }
        publish(key);
        pump(key);
      });
  }

  function add(
    target: ConversationTarget,
    input: Pick<PendingSend, "draft" | "text" | "retrySafe"> &
      Partial<Pick<PendingSend, "voiceRecordingDraftId" | "queued">>,
    deliver: DeliverPendingSend,
  ): void {
    const key = composerDraftKey(target);
    const send: PendingSend = {
      voiceRecordingDraftId: null,
      queued: false,
      ...input,
      starting: false,
      late: false,
      clientMessageId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      state: "waiting",
      messageId: null,
      error: null,
      errorReference: null,
    };
    deliverers.set(send.clientMessageId, deliver);
    queues.set(key, [...(queues.get(key) ?? []), send]);
    if (send.queued)
      window.setTimeout(() => {
        if (find(key, send.clientMessageId) !== send || send.state === "sent") return;
        send.late = true;
        publish(key);
      }, QUEUED_REVEAL_MS);
    publish(key);
    pump(key);
  }

  function retry(target: ConversationTarget, clientMessageId: string): void {
    const key = composerDraftKey(target);
    const send = find(key, clientMessageId);
    if (send?.state !== "failed" || !send.retrySafe) return;
    if (!pendingSendRetrySafe(send)) {
      send.retrySafe = false;
      publish(key);
      return;
    }
    send.state = "waiting";
    send.error = null;
    send.errorReference = null;
    publish(key);
    pump(key);
  }

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

export function pendingSendMessage(send: PendingSend): AgentMessage {
  return {
    id: `${PENDING_SEND_ID_PREFIX}${send.clientMessageId}`,
    author: "you",
    body: send.text,
    time: formatMessageTime(send.createdAt),
    createdAt: send.createdAt,
    replyToMessageId: send.draft.replyToMessageId,
    attachments: send.draft.attachments,
    animate: true,
  };
}
