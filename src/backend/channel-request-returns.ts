import type { ChannelMessage, ChannelTask, ChannelTaskState } from "@openbot/contracts/ipc";
import { Cause, Effect } from "effect";
import { type ChannelService, channelHandoffSenderAgentId } from "./channel-service";
import type { MailboxStore } from "./mailbox-store";

const RETURN_KEY_PREFIX = "channel-request-result:";
const RESULT_MESSAGE_PREFIX = "channel-result-";
const RECENT_MESSAGES = 400;
const ERROR_CHARACTERS = 2_000;
const ANSWER_CHARACTERS = 90_000;
const RETURNED_STATES: ReadonlySet<ChannelTaskState> = new Set(["completed", "failed", "cancelled"]);

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

  constructor(channels: ChannelService, mailbox: MailboxStore, hooks: ChannelRequestReturnHooks) {
    this.#channels = channels;
    this.#mailbox = mailbox;
    this.#hooks = hooks;
    for (const channelId of channels.store.ids())
      for (const pending of this.#finished(channelId)) this.#handled.add(pending.key);
  }

  readonly reconcile = Effect.fn("ChannelRequestReturns.reconcile")(function* (
    this: ChannelRequestReturns,
    channelId: string,
  ) {
    if (!this.#channels.store.exists(channelId)) return;
    const pending = this.#finished(channelId).filter((item) => !this.#handled.has(item.key));
    if (!pending.length) return;
    for (const item of pending) this.#handled.add(item.key);
    const channel = this.#channels.store.get(channelId);
    const channelName = channel.name;
    const recent = this.#channels.store.messages(channelId, Number.MAX_SAFE_INTEGER, RECENT_MESSAGES);
    for (const item of pending)
      yield* this.#send(item, channelId, channelName, channel.leadAgentId, recent).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.sync(() => {
                this.#handled.delete(item.key);
                this.#hooks.error(Cause.squash(cause));
              }),
        ),
      );
  });

  #finished(channelId: string): PendingReturn[] {
    return this.#channels.store.tasks(channelId).flatMap((task) => {
      if (task.parentTaskId !== null || !RETURNED_STATES.has(task.state)) return [];
      const request = this.#channels.store.message(channelId, task.requestMessageId);
      const requesterId = request ? channelHandoffSenderAgentId(request) : null;
      if (!request || !requesterId) return [];
      return [{ key: `${RETURN_KEY_PREFIX}${task.id}:${task.revision}:${task.state}`, task, request, requesterId }];
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
    const answer = task.state === "completed" ? taskAnswer(task, recent) : null;
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

  #attachmentPaths(answer: ChannelMessage): Effect.Effect<string[]> {
    return Effect.forEach(answer.message.attachments ?? [], (item) => this.#mailbox.resolveAttachment(item.id)).pipe(
      Effect.map((resolved) => resolved.flatMap((item) => (item ? [item.path] : []))),
      Effect.orElseSucceed(() => []),
    );
  }
}

function taskAnswer(task: ChannelTask, recent: readonly ChannelMessage[]): ChannelMessage | null {
  const answers = recent.filter(
    (message) =>
      message.taskId === task.id &&
      message.author.kind === "agent" &&
      !message.superseded &&
      message.message.text.trim() !== "" &&
      (message.id.startsWith(RESULT_MESSAGE_PREFIX) ||
        (message.message.status === "completed" && message.message.itemType !== "commentary")),
  );
  return answers.findLast((message) => message.id.startsWith(RESULT_MESSAGE_PREFIX)) ?? answers.at(-1) ?? null;
}

function returnText(task: ChannelTask, channelId: string, channelName: string, answer: ChannelMessage | null): string {
  const origin = `Channel: ${channelName} (${channelId}). This answers your openbot.send_to_channel request.`;
  if (task.state === "completed")
    return [
      origin,
      answer?.message.text.trim().slice(0, ANSWER_CHARACTERS) || "The member finished without a written result.",
    ].join("\n");
  const reason = (task.error ?? "").slice(0, ERROR_CHARACTERS);
  return [
    origin,
    "Status: blocked",
    task.state === "failed"
      ? `Result: OpenBot note, not written by this member: the channel task failed. ${reason || "No reason was given."}`
      : "Result: OpenBot note, not written by this member: a person stopped the channel task before it finished.",
    "Unblock: Read the channel, then send the request again if you still need the result.",
  ].join("\n");
}
