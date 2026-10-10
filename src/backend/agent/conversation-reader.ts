import type {
  AgentEvent,
  AgentSummary,
  ConversationFileSearchPage,
  ConversationOrderProofRequest,
  ConversationPageAnchor,
  ConversationReadState,
  ConversationSearchPage,
} from "@openbot/contracts/ipc";
import { Effect, Schema } from "effect";
import type { AgentStore } from "../agent-store";
import { type ConversationMarkerExclusions, ConversationReadStore } from "../conversation-read-store";
import { mergeConversationSnapshots } from "../conversation-snapshots";
import { causeHelpers } from "../effect-boundary";
import type { ConversationRuntime } from "./conversation-runtime";
import type { MailboxSync } from "./mailbox-sync";

export interface ConversationReaderHooks {
  emit(event: AgentEvent): void;
  listAgents(): AgentSummary[];
}

export interface ConversationReaderOptions {
  store: AgentStore;
  conversation: ConversationRuntime;
  mailboxSync: MailboxSync;
  hooks: ConversationReaderHooks;
}

/**
 * Owns the reads of a conversation and each member's read cursor: the snapshot, the page, the
 * search, and the read and unread marks.
 *
 * It never imports the agent service facade.
 */
export class ConversationReader {
  readonly #store: AgentStore;
  readonly #conversation: ConversationRuntime;
  readonly #mailboxSync: MailboxSync;
  readonly #reads: ConversationReadStore;
  readonly #hooks: ConversationReaderHooks;

  constructor(options: ConversationReaderOptions) {
    this.#store = options.store;
    this.#conversation = options.conversation;
    this.#mailboxSync = options.mailboxSync;
    this.#reads = new ConversationReadStore(options.store.database);
    this.#hooks = options.hooks;
  }

  readonly read = Effect.fn("ConversationReader.read")(function* (this: ConversationReader, agentId: string) {
    const agent = yield* this.#store.existing(agentId).pipe(toConversationReadFailed);
    return yield* readerStep(() => {
      // The legacy read endpoint still returns the complete durable conversation. `setSnapshot`
      // keeps only a bounded recent view after this transient response is built, so this read does
      // not turn a large chat into a long-lived process cache.
      const persisted = this.#store.database.readConversation(agentId, agent.threadId);
      const live = this.#conversation.snapshot(agentId);
      const snapshot = live?.activeTurnId ? mergeConversationSnapshots(persisted, live) : persisted;
      this.#mailboxSync.syncMailboxMessages(snapshot);
      this.#conversation.setSnapshot(agentId, snapshot);
      return structuredClone(snapshot);
    });
  }, Effect.uninterruptible);

  readonly readFor = Effect.fn("ConversationReader.readFor")(function* (
    this: ConversationReader,
    agentId: string,
    memberId: string,
  ) {
    const snapshot = yield* this.read(agentId);
    return yield* readerStep(() => {
      return {
        ...snapshot,
        readState: this.#reads.readState(memberId, snapshot),
      };
    });
  }, Effect.uninterruptible);

  readonly readPageFor = Effect.fn("ConversationReader.readPageFor")(function* (
    this: ConversationReader,
    agentId: string,
    memberId: string,
    anchor: ConversationPageAnchor = { type: "latest" },
    limit = 50,
    options: ConversationMarkerExclusions = {},
    orderProof?: ConversationOrderProofRequest,
  ) {
    if (orderProof)
      return yield* readerStep(() => {
        // Roster membership selects the readable thread. Do not call existing(), which creates a workspace.
        const agent = this.#store.list().find((agent) => agent.id === agentId);
        if (!agent) throw new Error("Conversation proof agent is unavailable.");
        return this.#store.database.readConversationOrderProof(agentId, agent.threadId, orderProof);
      });
    const agent = yield* this.#store.existing(agentId).pipe(toConversationReadFailed);
    return yield* readerStep(() => {
      this.#mailboxSync.reconcilePersistedMailboxMessages(agent);
      const page = this.#store.database.readConversationPage(agentId, agent.threadId, anchor, limit, options);
      return {
        ...page,
        readState: this.#reads.readStateForThread(memberId, agent.threadId, options),
      };
    });
  }, Effect.uninterruptible);

  search(query: string, agentId?: string, cursor?: string, limit = 100): ConversationSearchPage {
    return this.#store.database.searchConversationMessages(query, agentId, cursor, limit);
  }

  searchFiles(query: string, cursor?: string, limit = 50): ConversationFileSearchPage {
    return this.#store.database.searchConversationFiles(query, cursor, limit);
  }

  listReads(memberId: string, options: ConversationMarkerExclusions = {}): Record<string, ConversationReadState> {
    return this.#reads.listStates(memberId, this.#hooks.listAgents(), options);
  }

  adoptReads(sourceMemberId: string, targetMemberId: string): void {
    this.#reads.adoptMemberState(sourceMemberId, targetMemberId);
  }

  readonly markRead = Effect.fn("ConversationReader.markRead")(function* (
    this: ConversationReader,
    agentId: string,
    memberId: string,
    throughMessageId: string | null,
    options: ConversationMarkerExclusions = {},
  ) {
    const agent = yield* this.#store.existing(agentId).pipe(toConversationReadFailed);
    return yield* readerStep(() => {
      const previous = this.#reads.readStateForThread(memberId, agent.threadId, options).throughMessageId;
      const state = this.#reads.markReadForThread(memberId, agent.threadId, throughMessageId, options);
      if (state.throughMessageId !== previous) {
        // Read cursors are shared by a member's devices, not by every team member.
        // Invalidate without broadcasting a reader's cursor; each client reloads its own state.
        this.#hooks.emit({
          type: "conversation-invalidated",
          agentId,
          revision: this.#store.database.readConversationRevision(agentId, agent.threadId),
        });
      }
      return state;
    });
  }, Effect.uninterruptible);

  readonly markUnread = Effect.fn("ConversationReader.markUnread")(function* (
    this: ConversationReader,
    agentId: string,
    memberId: string,
  ) {
    const agent = yield* this.#store.existing(agentId).pipe(toConversationReadFailed);
    return yield* readerStep(() => {
      const state = this.#reads.markUnreadForThread(memberId, agent.threadId);
      this.#hooks.emit({
        type: "conversation-invalidated",
        agentId,
        revision: this.#store.database.readConversationRevision(agentId, agent.threadId),
      });
      return state;
    });
  }, Effect.uninterruptible);
}

class ConversationReadFailed extends Schema.TaggedError<ConversationReadFailed>()("ConversationReadFailed", {
  cause: Schema.Defect(),
}) {}

const { sync: readerStep, rewrap: toConversationReadFailed } = causeHelpers(ConversationReadFailed);
