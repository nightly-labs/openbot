import { feedbackSentIssue, feedbackSentItemType, feedbackWithdrawnItemType } from "@openbot/contracts/feedback";
import type { ConversationMessage, WithdrawFeedbackInput } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect } from "effect";
import type { AgentStore } from "../agent-store";
import type { AgentTasks } from "../agent-tasks/agent-tasks";
import { type StoredStateFailure, storedSync } from "../stored-state-effects";
import type { ConversationRuntime } from "./conversation-runtime";
import type { AgentFeedback, FeedbackWithdrawResult } from "./openbot-tool-router";
import type { ToolOperationFailed } from "./tool-operation";

export interface FeedbackWithdrawalOptions {
  store: AgentStore;
  conversation: ConversationRuntime;
  tasks: AgentTasks;
  feedback: AgentFeedback | null;
}

interface CardTarget {
  threadId: string;
  message: ConversationMessage;
}

export type FeedbackCardWithdrawResult = FeedbackWithdrawResult | { readonly status: "notFound" };

const FEEDBACK_WITHDRAWN_EVENT = "feedback.withdrawn";
const logger = createOpenBotLogger("feedback-withdrawal");

function cardTitle(text: string): string {
  const prefix = sourceText("status.agent.feedbackSent", { title: "" });
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

export class FeedbackWithdrawal {
  readonly #store: AgentStore;
  readonly #conversation: ConversationRuntime;
  readonly #tasks: AgentTasks;
  readonly #feedback: AgentFeedback | null;

  constructor(options: FeedbackWithdrawalOptions) {
    this.#store = options.store;
    this.#conversation = options.conversation;
    this.#tasks = options.tasks;
    this.#feedback = options.feedback;
  }

  readonly withdrawCard = Effect.fn("FeedbackWithdrawal.withdrawCard")(function* (
    this: FeedbackWithdrawal,
    input: WithdrawFeedbackInput,
  ): Effect.fn.Return<FeedbackCardWithdrawResult, ToolOperationFailed | StoredStateFailure> {
    const target = yield* storedSync(() => this.#target(input));
    const issue = target && feedbackSentIssue(target.message);
    if (!target || !issue) return { status: "notFound" };
    if (issue.withdrawn) return { status: "withdrawn" };
    return yield* this.withdraw(input.agentId, target.threadId, issue.number, target);
  });

  readonly withdraw = Effect.fn("FeedbackWithdrawal.withdraw")(function* (
    this: FeedbackWithdrawal,
    agentId: string,
    threadId: string,
    number: number,
    card?: CardTarget,
  ): Effect.fn.Return<FeedbackWithdrawResult, ToolOperationFailed> {
    if (!this.#feedback) return { status: "signedOut" };
    const result = yield* this.#feedback.withdraw(number);
    if (result.status === "withdrawn")
      yield* storedSync(() => this.#markWithdrawn(agentId, threadId, number, card)).pipe(
        Effect.catchTag("StoredStateFailure", ({ cause }) =>
          Effect.sync(() => logger.warn("The card of a removed report was not updated.", { error: toLogValue(cause) })),
        ),
      );
    return result;
  });

  #target(input: WithdrawFeedbackInput): CardTarget | null {
    const agent = this.#store.list().find((candidate) => candidate.id === input.agentId);
    if (!agent?.threadId) return null;
    const snapshot = this.#conversation.ensureSnapshot(agent.id, agent.threadId);
    const threadId = snapshot.threadId;
    if (!threadId) return null;
    const message =
      snapshot.messages.find((candidate) => candidate.id === input.messageId) ??
      this.#store.database.readConversationMessages(agent.id, threadId, [input.messageId])[0];
    return message ? { threadId, message } : null;
  }

  #markWithdrawn(agentId: string, threadId: string, number: number, card?: CardTarget): void {
    const taskId =
      this.#tasks.openTaskIds(agentId).find((candidate) => this.#tasks.threadId(candidate) === threadId) ?? null;
    const current = taskId ? this.#tasks.read(agentId, taskId) : this.#conversation.ensureSnapshot(agentId, threadId);
    const loaded = current.threadId === threadId;
    const snapshot = structuredClone(current);
    const removed = (message: ConversationMessage): ConversationMessage => ({
      ...message,
      itemType: feedbackWithdrawnItemType(number),
      text: sourceText("status.agent.feedbackWithdrawn", { title: cardTitle(message.text) }),
    });
    const changed: ConversationMessage[] = [];
    if (loaded)
      snapshot.messages = snapshot.messages.map((message) => {
        const issue = feedbackSentIssue(message);
        if (!issue || issue.withdrawn || issue.number !== number) return message;
        const next = removed(message);
        changed.push(next);
        return next;
      });
    const stored = this.#store.database.readConversationMessagesOfItemType(
      agentId,
      threadId,
      feedbackSentItemType(number),
    );
    for (const message of card ? [card.message, ...stored] : stored)
      if (!changed.some((candidate) => candidate.id === message.id) && feedbackSentIssue(message)?.withdrawn === false)
        changed.push(removed(message));
    if (changed.length === 0) return;
    const revision = this.#store.database.persistConversationChanges({
      agentId,
      threadId,
      activeTurnId: loaded
        ? snapshot.activeTurnId
        : this.#store.database.readConversationPage(agentId, threadId, { type: "latest" }, 1).activeTurnId,
      changedMessages: changed,
      eventType: FEEDBACK_WITHDRAWN_EVENT,
      detail: {},
    });
    if (loaded) {
      snapshot.revision = revision;
      this.#conversation.setSnapshot(agentId, snapshot);
      this.#conversation.publishConversation(snapshot);
    }
    if (taskId) this.#tasks.changed(agentId);
  }
}
