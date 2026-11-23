import type {
  AgentEvent,
  AgentSummary,
  ConversationFileSearchPage,
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
  emit(event: AgentEvent, memberId?: string): void;
  listAgents(): AgentSummary[];
}

export interface ConversationReaderOptions {
  store: AgentStore;
  conversation: ConversationRuntime;
  mailboxSync: MailboxSync;
  hooks: ConversationReaderHooks;
}

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
  ) {
    const agent = yield* this.#store.existing(agentId).pipe(toConversationReadFailed);
    return yield* readerStep(() => {
      this.#mailboxSync.reconcilePersistedMailboxMessages(agent);
      const page = this.#store.database.readConversationPage(agentId, agent.threadId, anchor, limit, options);
      this.#mailboxSync.refreshQueuePositions(page.messages);
      return {
        ...page,
        readState: this.#reads.readStateForThread(memberId, agent.threadId, options),
      };
    });
  }, Effect.uninterruptible);

  search(
    query: string,
    agentId?: string,
    cursor?: string,
    limit = 100,
    includeSideThreads = false,
  ): ConversationSearchPage {
    return this.#store.database.searchConversationMessages(query, agentId, cursor, limit, includeSideThreads);
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

  readThread(memberId: string, threadId: string, options: ConversationMarkerExclusions = {}) {
    return this.#reads.readStateForThread(memberId, threadId, options);
  }

  markThreadRead(
    memberId: string,
    threadId: string,
    throughMessageId: string,
    options: ConversationMarkerExclusions = {},
  ) {
    return this.#reads.markReadForThread(memberId, threadId, throughMessageId, options);
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
        this.#hooks.emit(
          {
            type: "conversation-invalidated",
            agentId,
            revision: this.#store.database.readConversationRevision(agentId, agent.threadId),
          },
          memberId,
        );
      }
      return state;
    });
  }, Effect.uninterruptible);

  readonly markUnread = Effect.fn("ConversationReader.markUnread")(function* (
    this: ConversationReader,
    agentId: string,
    memberId: string,
    fromMessageId: string | null = null,
    options: ConversationMarkerExclusions = {},
  ) {
    const agent = yield* this.#store.existing(agentId).pipe(toConversationReadFailed);
    return yield* readerStep(() => {
      const state = this.#reads.markUnreadForThread(memberId, agent.threadId, fromMessageId, options);
      this.#hooks.emit(
        {
          type: "conversation-invalidated",
          agentId,
          revision: this.#store.database.readConversationRevision(agentId, agent.threadId),
        },
        memberId,
      );
      return state;
    });
  }, Effect.uninterruptible);
}

class ConversationReadFailed extends Schema.TaggedError<ConversationReadFailed>()("ConversationReadFailed", {
  cause: Schema.Defect(),
}) {}

const { sync: readerStep, rewrap: toConversationReadFailed } = causeHelpers(ConversationReadFailed);
