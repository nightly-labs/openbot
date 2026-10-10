import { createHash } from "node:crypto";
import type {
  Channel,
  ChannelAudienceInput,
  ChannelAudienceReceiptInput,
  ChannelAudienceResult,
  ChannelMessage,
  ChannelTask,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";
import { type ChannelOperationError, channelFailure, channelSync } from "./channel-effects";
import { type ChannelStore, channelAudienceOperationKey } from "./channel-store";
import type { MailboxStore } from "./mailbox-store";

interface ChannelAudienceOptions {
  store: ChannelStore;
  mailbox: MailboxStore;
  requireMember(channel: Channel, agentId: string): void;
  task(channelId: string, requestId: string, text: string, agentId: string): ChannelTask;
  message(
    channelId: string,
    taskId: string,
    author: ChannelMessage["author"],
    text: string,
    id: string,
  ): ChannelMessage;
  serialize(
    channelId: string,
    operation: Effect.Effect<ChannelAudienceResult, ChannelOperationError>,
  ): Effect.Effect<ChannelAudienceResult, ChannelOperationError>;
  publish(channelId: string): void;
  wake(channelId: string): Effect.Effect<void, ChannelOperationError>;
}

/** Owns explicit host-accepted channel audiences. It never starts or retries provider turns. */
export class ChannelAudienceCommands {
  constructor(readonly options: ChannelAudienceOptions) {}

  receipt(input: ChannelAudienceReceiptInput, actorId: string): ChannelAudienceResult | null {
    return this.options.store.audienceReceipt(input, actorId);
  }

  send = Effect.fn("ChannelAudienceCommands.send")((input: ChannelAudienceInput, actor: { id: string; name: string }) =>
    this.options.serialize(input.channelId, this.accept(input, actor)),
  );

  private accept = Effect.fn("ChannelAudienceCommands.accept")(function* (
    this: ChannelAudienceCommands,
    input: ChannelAudienceInput,
    actor: { id: string; name: string },
  ): Effect.fn.Return<ChannelAudienceResult, ChannelOperationError> {
    const { store, mailbox } = this.options;
    const saved = yield* channelSync(() => this.receipt(input, actor.id));
    if (saved) {
      if (!("status" in saved)) yield* this.options.wake(input.channelId);
      return saved;
    }
    const initial = yield* channelSync(() => store.get(input.channelId));
    const initialTargets = yield* channelSync(() => this.validate(initial, input)).pipe(Effect.result);
    if (Result.isFailure(initialTargets)) return yield* channelSync(() => store.rejectAudience(input, actor.id));
    const key = channelAudienceOperationKey(input, actor.id);
    const requestId = `audience-${key.slice("channel-audience:".length)}`;
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          input.text,
          input.audience.kind,
          input.audience.kind === "members" ? input.audience.agentIds : null,
          input.replyToMessageId,
          input.attachmentDraftIds,
        ]),
      )
      .digest("hex");
    const prepared = input.attachmentDraftIds.length
      ? yield* mailbox
          .commitChannelAttachments({
            channelId: input.channelId,
            messageId: requestId,
            text: input.text,
            draftIds: input.attachmentDraftIds,
            preparation: { operationKey: key, fingerprint },
          })
          .pipe(Effect.mapError(channelFailure))
      : null;
    // File preparation has its own durable receipt. It proves no root/task acceptance.
    const channel = yield* channelSync(() => store.get(input.channelId));
    const checked = yield* channelSync(() => this.validate(channel, input)).pipe(Effect.result);
    if (Result.isFailure(checked)) return yield* channelSync(() => store.rejectAudience(input, actor.id));
    const targets = checked.success;
    const text = prepared?.text ?? input.text;
    const tasks = targets.map((agentId) => this.options.task(channel.id, requestId, text, agentId));
    const message = this.options.message(channel.id, "", { kind: "member", ...actor }, text, requestId);
    message.taskId = null;
    message.audience = tasks.map((task, index) => ({ agentId: targets[index] ?? "", taskId: task.id }));
    message.message.replyToMessageId = input.replyToMessageId;
    if (prepared) message.message.attachments = prepared.attachments;
    const receipt = yield* channelSync(() =>
      store.commitAudience(input, actor.id, { channel, messages: [message], tasks, assignments: [] }, requestId),
    );
    // The view discards original draft files only when it still owns the whole submitted draft.
    // A changed draft can still refer to these files after this task acceptance.
    this.options.publish(channel.id);
    yield* this.options.wake(channel.id);
    return receipt;
  }).bind(this);

  private validate(channel: Channel, input: ChannelAudienceInput): string[] {
    if (channel.archived) throw new Error(sourceText("error.backend.channelArchived"));
    const targets =
      input.audience.kind === "all" ? channel.members.map((member) => member.agentId) : input.audience.agentIds;
    if (!targets.length || targets.length > 100 || new Set(targets).size !== targets.length)
      throw new Error("Invalid channel audience.");
    for (const target of targets) this.options.requireMember(channel, target);
    if (
      input.replyToMessageId &&
      !this.options.store.messages(channel.id).some((message) => message.id === input.replyToMessageId)
    )
      throw new Error(sourceText("error.backend.channelReferenceUnavailable"));
    return [...targets];
  }
}
