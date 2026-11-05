import { createHash } from "node:crypto";
import type { ConversationMessageSender, QueuedMessageReceipt, RewriteMessageInput } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Schema } from "effect";
import type { AgentStore } from "../agent-store";
import type { AgentTasks } from "../agent-tasks/agent-tasks";
import type { MailboxStore } from "../mailbox-store";
import type { ConversationRuntime } from "./conversation-runtime";
import type { DrainScheduler } from "./drain-scheduler";
import type { MailboxSync } from "./mailbox-sync";
import type { ThreadLifecycle } from "./thread-lifecycle";

export interface MessageRewritesOptions {
  store: AgentStore;
  mailbox: MailboxStore;
  conversation: ConversationRuntime;
  tasks: AgentTasks;
  threads: ThreadLifecycle;
  mailboxSync: MailboxSync;
  drain: DrainScheduler;
  agentsChanged(): void;
}

/** Owns historical question rewrites and their restart recovery. Never imports the service facade. */
export class MessageRewrites {
  readonly #store: AgentStore;
  readonly #mailbox: MailboxStore;
  readonly #conversation: ConversationRuntime;
  readonly #tasks: AgentTasks;
  readonly #threads: ThreadLifecycle;
  readonly #mailboxSync: MailboxSync;
  readonly #drain: DrainScheduler;
  readonly #agentsChanged: () => void;
  readonly #pending = new Map<string, Deferred.Deferred<QueuedMessageReceipt, MessageRewriteFailed>>();

  constructor(options: MessageRewritesOptions) {
    this.#store = options.store;
    this.#mailbox = options.mailbox;
    this.#conversation = options.conversation;
    this.#tasks = options.tasks;
    this.#threads = options.threads;
    this.#mailboxSync = options.mailboxSync;
    this.#drain = options.drain;
    this.#agentsChanged = options.agentsChanged;
  }

  /** Finish committed rewrites before providers and queue recovery start. */
  recover(): void {
    for (const intent of this.#mailbox.pendingRewrites()) {
      if (!this.#store.list().some((agent) => agent.id === intent.agentId)) continue;
      // A restart can stop between these writes. Retire the old session before making the cut visible.
      this.#store.database.deactivateProviderSessions(intent.threadId);
      if (this.#store.database.readConversationMessages(intent.agentId, intent.threadId, [intent.messageId]).length)
        this.#store.database.rewindConversation(intent.agentId, intent.threadId, intent.messageId);
    }
  }

  #validate(input: RewriteMessageInput, sender: ConversationMessageSender | undefined, source: "host" | "member") {
    const agent = this.#conversation.requireKnownAgent(input.agentId);
    if (agent.hiddenAt !== undefined) throw new Error(sourceText("error.backend.recipientHidden"));
    const task = input.taskId ? this.#tasks.requireOpen(agent.id, input.taskId) : null;
    const threadId = task?.threadId ?? agent.threadId;
    if (!threadId) throw new Error(sourceText("error.backend.threadNotFound"));
    const busy = task
      ? this.#tasks.publicTask(task).state !== "idle"
      : this.#mailbox.hasUnfinishedDeliveryOutsideTasks(agent.id) || this.#threads.mainContextBusy(agent);
    if (busy) throw new Error(sourceText("error.backend.rewriteSourceBusy"));
    const message = this.#store.database
      .readConversation(agent.id, threadId)
      .messages.find((item) => item.id === input.messageId);
    if (message?.author !== "user" || (message.source && message.source !== "user") || message.status !== "completed")
      throw new Error(sourceText("error.backend.rewriteMessageMissing"));
    const owner = message.senderMember ?? this.#mailbox.messageSender(agent.id, input.taskId, message.id);
    // The local host may edit an unattributed legacy message, but a known owner must match even
    // when the host has no signed-in sender. Remote members always need positive attribution.
    if (owner ? owner.id !== sender?.id : source !== "host")
      throw new Error(sourceText("error.backend.rewriteOtherMember"));
    return { agent, task, threadId, message };
  }

  /** Edits one finished user request and starts a new turn in the same thread. */
  readonly rewrite = Effect.fn("MessageRewrites.rewriteMessage")(function* (
    this: MessageRewrites,
    input: RewriteMessageInput,
    sender?: ConversationMessageSender,
    source: "host" | "member" = "member",
  ): Effect.fn.Return<QueuedMessageReceipt, MessageRewriteFailed> {
    const idempotencyKey = `user-rewrite:${createHash("sha256")
      .update(JSON.stringify([source, sender?.id ?? null, input.agentId, input.taskId, input.requestId]))
      .digest("hex")}`;
    const pending = this.#pending.get(idempotencyKey);
    if (pending) return yield* Deferred.await(pending);
    const priorReceipt = this.#mailbox.receiptForKey(idempotencyKey);
    if (priorReceipt) {
      const intent = this.#mailbox.pendingRewrites().find((item) => item.deliveryId === priorReceipt.deliveries[0]?.id);
      if (intent) {
        yield* this.#mailbox.withEnqueueLock(() =>
          this.#cutForRewrite(intent.agentId, input.taskId, intent.threadId, intent.messageId),
        );
        if (input.taskId) this.#tasks.changed(input.agentId);
        else {
          const current = this.#conversation.ensureSnapshot(input.agentId, intent.threadId);
          this.#mailboxSync.syncMailboxMessages(current);
          this.#conversation.emitConversation(current);
        }
      }
      this.#mailboxSync.emitQueue(input.agentId);
      this.#drain.scheduleDrain(input.agentId);
      return priorReceipt;
    }
    const rewrite = Deferred.makeUnsafe<QueuedMessageReceipt, MessageRewriteFailed>();
    this.#pending.set(idempotencyKey, rewrite);
    return yield* this.#rewriteMessage(input, sender, source, idempotencyKey).pipe(
      Effect.onExit((exit) => Deferred.done(rewrite, exit)),
      Effect.ensuring(Effect.sync(() => this.#pending.delete(idempotencyKey))),
    );
  }, Effect.uninterruptible).bind(this);

  readonly #cutForRewrite = Effect.fn("MessageRewrites.cutForRewrite")(function* (
    this: MessageRewrites,
    agentId: string,
    taskId: string | null,
    threadId: string,
    messageId: string,
  ) {
    if (!this.#store.database.readConversationMessages(agentId, threadId, [messageId]).length) return;
    // End the provider session before removing history. A queued rewrite is held until this cut.
    yield* this.#threads.endThreadContext(threadId);
    yield* rewriteStep(() => {
      const work = () => {
        const snapshot = this.#store.database.rewindConversation(agentId, threadId, messageId);
        return { result: undefined, snapshot };
      };
      if (taskId) this.#conversation.withThreadTransaction(agentId, threadId, work);
      else this.#conversation.withConversationTransaction(agentId, work);
    });
  }, Effect.uninterruptible).bind(this);

  readonly #rewriteMessage = Effect.fn("MessageRewrites.performMessageRewrite")(function* (
    this: MessageRewrites,
    input: RewriteMessageInput,
    sender: ConversationMessageSender | undefined,
    source: "host" | "member",
    idempotencyKey: string,
  ): Effect.fn.Return<QueuedMessageReceipt, MessageRewriteFailed> {
    const { agent, task, threadId, message } = yield* rewriteStep(() => this.#validate(input, sender, source));
    const sourceAttachments: Array<{ id: string; path: string }> = [];
    for (const attachment of message.attachments ?? []) {
      const file = yield* this.#mailbox
        .resolveAttachment(attachment.id)
        .pipe(Effect.mapError((failure) => new MessageRewriteFailed({ cause: failure.cause })));
      if (!file)
        return yield* new MessageRewriteFailed({
          cause: new Error(sourceText("error.backend.rewriteAttachmentMissing")),
        });
      sourceAttachments.push({ id: attachment.id, path: file.path });
    }
    let voiceRecordingSource: { path: string; mimeType: string } | undefined;
    if (message.voiceRecording) {
      const file = yield* this.#mailbox
        .resolveAttachment(message.voiceRecording.id)
        .pipe(Effect.mapError((failure) => new MessageRewriteFailed({ cause: failure.cause })));
      if (!file)
        return yield* new MessageRewriteFailed({
          cause: new Error(sourceText("error.backend.rewriteAttachmentMissing")),
        });
      voiceRecordingSource = { path: file.path, mimeType: message.voiceRecording.mimeType };
    }
    const service = this;
    const receipt = yield* this.#mailbox.withEnqueueLock((enqueue) =>
      Effect.gen(function* () {
        yield* rewriteStep(() => {
          const current = service.#validate(input, sender, source);
          if (current.threadId !== threadId) throw new Error(sourceText("error.backend.rewriteMessageMissing"));
        });
        const receipt = yield* enqueue({
          sender: { kind: "user" },
          ...(sender ? { senderMember: sender } : {}),
          ...(task ? { taskId: task.taskId } : {}),
          recipientAgentIds: [agent.id],
          text: input.text,
          sourceAttachments,
          rewriteSource: { threadId, messageId: input.messageId },
          ...(voiceRecordingSource ? { voiceRecordingSource } : {}),
          idempotencyKey,
        }).pipe(Effect.mapError((failure) => new MessageRewriteFailed({ cause: failure.cause })));
        if (!receipt.deliveries[0]?.id)
          return yield* new MessageRewriteFailed({
            cause: new Error(sourceText("error.backend.rewriteQueueFailed")),
          });
        yield* service.#cutForRewrite(agent.id, task?.taskId ?? null, threadId, input.messageId);
        return receipt;
      }),
    );
    if (task) this.#tasks.changed(agent.id);
    else {
      const current = this.#conversation.ensureSnapshot(agent.id, threadId);
      this.#mailboxSync.syncMailboxMessages(current);
      this.#conversation.emitConversation(current);
      yield* this.#store.updatePreview(agent.id, input.text).pipe(Effect.ignore);
      this.#agentsChanged();
    }
    this.#mailboxSync.emitQueue(agent.id);
    this.#drain.scheduleDrain(agent.id);
    return receipt;
  }, Effect.uninterruptible).bind(this);
}

export class MessageRewriteFailed extends Schema.TaggedError<MessageRewriteFailed>()("MessageRewriteFailed", {
  cause: Schema.Defect(),
}) {}

function rewriteStep<A>(run: () => A): Effect.Effect<A, MessageRewriteFailed> {
  return Effect.try({ try: run, catch: (cause) => new MessageRewriteFailed({ cause }) });
}
