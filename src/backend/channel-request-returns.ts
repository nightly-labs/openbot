import type { ChannelMessage, ChannelTask, ChannelTaskState } from "@openbot/contracts/ipc";
import { Cause, Effect } from "effect";
import { isTaskAnswer } from "./channel-history";
import { type ChannelService, channelHandoffSenderAgentId, channelResultId } from "./channel-service";
import type { MailboxStore } from "./mailbox-store";

const RETURN_KEY_PREFIX = "channel-request-result:";
const RECENT_MESSAGES = 400;
const ERROR_CHARACTERS = 2_000;
const ANSWER_CHARACTERS = 90_000;
const RETURNED_STATES: ReadonlySet<ChannelTaskState> = new Set(["completed", "failed", "cancelled", "paused"]);

export interface ChannelRequestReturnHooks {
  agentExists(agentId: string): boolean;
  delivered(recipientAgentId: string, deliveryIds: readonly string[]): Effect.Effect<void>;
  error(error: unknown): void;
}

interface PendingReturn {
  key: string;
  task: ChannelTask;
  request: ChannelMessage;
  requesterId: string;
}

export class ChannelRequestReturns {
  readonly #channels: ChannelService;
  readonly #mailbox: MailboxStore;
  readonly #hooks: ChannelRequestReturnHooks;
  readonly #handled = new Set<string>();
  #restored = false;

  constructor(channels: ChannelService, mailbox: MailboxStore, hooks: ChannelRequestReturnHooks) {
    this.#channels = channels;
    this.#mailbox = mailbox;
    this.#hooks = hooks;
  }

  restore(): void {
    for (const channelId of this.#channels.store.ids())
      for (const task of this.#channels.store.tasks(channelId)) if (returned(task)) this.#handled.add(returnKey(task));
    this.#restored = true;
  }

  readonly reconcile = Effect.fn("ChannelRequestReturns.reconcile")(function* (
    this: ChannelRequestReturns,
    channelId: string,
  ) {
    if (!this.#restored || !this.#channels.store.exists(channelId)) return;
    const pending = this.#pending(channelId);
    if (!pending.length) return;
    const channel = this.#channels.store.get(channelId);
    const recent = this.#channels.store.messages(channelId, Number.MAX_SAFE_INTEGER, RECENT_MESSAGES);
    for (const item of pending)
      yield* this.#send(item, channelId, channel.name, channel.leadAgentId, recent).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.sync(() => this.#hooks.error(Cause.squash(cause))),
        ),
      );
  });

  #pending(channelId: string): PendingReturn[] {
    return this.#channels.store.tasks(channelId).flatMap((task) => {
      if (!returned(task)) return [];
      const key = returnKey(task);
      if (this.#handled.has(key)) return [];
      this.#handled.add(key);
      const request = this.#channels.store.message(channelId, task.requestMessageId);
      if (request && movedToOpenTask(task, request)) return [];
      const requesterId = request ? channelHandoffSenderAgentId(request) : null;
      if (!request || !requesterId) return [];
      return [{ key, task, request, requesterId }];
    });
  }

  readonly #send = Effect.fn("ChannelRequestReturns.send")(function* (
    this: ChannelRequestReturns,
    { key, task, request, requesterId }: PendingReturn,
    channelId: string,
    channelName: string,
    leadAgentId: string | null,
    recent: readonly ChannelMessage[],
  ) {
    const senderAgentId = task.ownerAgentId ?? leadAgentId;
    if (
      !senderAgentId ||
      senderAgentId === requesterId ||
      !this.#hooks.agentExists(senderAgentId) ||
      !this.#hooks.agentExists(requesterId)
    )
      return;
    const answer = task.state === "completed" ? this.#answer(channelId, task, request, recent) : null;
    const sourcePaths = answer ? yield* this.#attachmentPaths(answer) : [];
    const receipt = yield* this.#mailbox.enqueue({
      sender: { kind: "agent", agentId: senderAgentId },
      recipientAgentIds: [requesterId],
      text: returnText(task, channelId, channelName, answer),
      sourcePaths,
      replyToMessageId: request.id,
      expectsReply: false,
      idempotencyKey: key,
    });
    yield* this.#hooks.delivered(
      requesterId,
      receipt.deliveries.map((delivery) => delivery.id),
    );
  });

  #answer(
    channelId: string,
    task: ChannelTask,
    request: ChannelMessage,
    recent: readonly ChannelMessage[],
  ): ChannelMessage | null {
    const [latest] = this.#channels.store
      .assignments(channelId)
      .filter((assignment) => assignment.taskId === task.id)
      .sort((left, right) => right.taskRevision - left.taskRevision);
    const result = latest ? this.#channels.store.message(channelId, channelResultId(latest)) : null;
    if (result && !result.superseded && result.message.text.trim()) return result;
    return (
      recent.findLast(
        (message) => message.sequence > request.sequence && !message.superseded && isTaskAnswer(message, task.id),
      ) ?? null
    );
  }

  #attachmentPaths(answer: ChannelMessage): Effect.Effect<string[]> {
    return Effect.forEach(answer.message.attachments ?? [], (item) => this.#mailbox.resolveAttachment(item.id)).pipe(
      Effect.map((resolved) => resolved.flatMap((item) => (item ? [item.path] : []))),
      Effect.orElseSucceed(() => []),
    );
  }
}

function returned(task: ChannelTask): boolean {
  return task.parentTaskId === null && RETURNED_STATES.has(task.state);
}

function movedToOpenTask(task: ChannelTask, request: ChannelMessage): boolean {
  return (
    task.state === "cancelled" && task.ownerAgentId === null && request.taskId !== null && request.taskId !== task.id
  );
}

function returnKey(task: ChannelTask): string {
  return `${RETURN_KEY_PREFIX}${task.id}:${task.revision}:${task.state}`;
}

function returnText(task: ChannelTask, channelId: string, channelName: string, answer: ChannelMessage | null): string {
  const origin = `Channel: ${channelName} (${channelId}). This answers your openbot.send_to_channel request.`;
  if (task.state === "completed")
    return [
      origin,
      answer?.message.text.trim().slice(0, ANSWER_CHARACTERS) || "The member finished without a written result.",
    ].join("\n");
  const reason = (task.error ?? "").trim().slice(0, ERROR_CHARACTERS);
  if (task.state === "paused")
    return [
      origin,
      "Status: paused",
      `Result: OpenBot note, not written by this member: the channel task stopped before it finished. ${reason}`.trim(),
      "Next: Do not send the request again. A person can continue the task in the channel, and its result then comes back here.",
    ].join("\n");
  return [
    origin,
    "Status: blocked",
    `Result: OpenBot note, not written by this member: the channel task ${task.state === "failed" ? "failed" : "was cancelled"} before it finished. ${reason}`.trim(),
    "Unblock: Read the channel, then send the request again if you still need the result.",
  ].join("\n");
}
