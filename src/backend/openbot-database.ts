import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  AgentProviderId,
  AgentSummary,
  ConversationFileSearchPage,
  ConversationMessage,
  ConversationPage,
  ConversationPageAnchor,
  ConversationSearchPage,
  ConversationSnapshot,
  HostedSiteConversationEventStatus,
  MessagePinner,
  SentMessageStats,
} from "@openbot/contracts/ipc";
import { AgentHistoryQueries, type AgentHistorySelection } from "./database/agent-history-queries";
import { type AgentModelChange, AgentRoster } from "./database/agent-roster";
import { AgentUsage } from "./database/agent-usage";
import { type ConversationMarkerExclusions, ConversationQueries } from "./database/conversation-queries";
import { ConversationWriter } from "./database/conversation-writer";
import { DatabaseCore, type DatabaseCoreOptions, type OrchestrationEventInput } from "./database/database-core";
import { deletedThreadMessageIds, threadMessageIds } from "./database/deleted-thread-messages";
import {
  type ActiveHostedSiteConversationEvent,
  HostedSiteEventLog,
  type PendingHostedSiteTerminalEvent,
} from "./database/hosted-site-event-log";
import {
  MailboxProjection,
  type MailboxProjectionChanges,
  type MailboxProjectionState,
} from "./database/mailbox-projection";
import {
  type PinnedThreadMessage,
  pinnedThreadMessageCount,
  pinnedThreadMessages,
  pinThreadMessage,
  threadMessagePinner,
  threadMessagesContaining,
  unpinThreadMessage,
} from "./database/pinned-thread-messages";
import {
  type ProviderHistoryCompactionBatch,
  type ProviderHistoryImportState,
  type ProviderHistorySessionInput,
  type ProviderHistoryStagedItem,
  type ProviderHistoryStagedTurn,
  type ProviderHistoryStagedTurnPage,
  type ProviderHistoryStageResult,
  ProviderHistoryStore,
  type ProviderHistoryTurnCursor,
} from "./database/provider-history-store";
import { type ProviderSession, ProviderSessions } from "./database/provider-sessions";
import { withTransaction } from "./database/sqlite-transaction";
import { ThreadEventCompaction, type ThreadEventCompactionBatch } from "./database/thread-event-compaction";
import { ThreadReplay } from "./database/thread-replay";
import { type StoredThreadSummary, ThreadSummaries } from "./database/thread-summaries";

export type { OrchestrationEventInput } from "./database/database-core";
export type {
  ActiveHostedSiteConversationEvent,
  PendingHostedSiteTerminalEvent,
} from "./database/hosted-site-event-log";
export type {
  ProviderHistoryCompactionBatch,
  ProviderHistoryImportState,
  ProviderHistorySessionInput,
  ProviderHistoryStagedItem,
  ProviderHistoryStagedTurn,
  ProviderHistoryStagedTurnPage,
  ProviderHistoryStageResult,
  ProviderHistoryTurnCursor,
} from "./database/provider-history-store";

import { perfTimed } from "./perf-probe-hooks";

export type { ProviderSession } from "./database/provider-sessions";
export type { ThreadEventCompactionBatch } from "./database/thread-event-compaction";
export type { StoredThreadSummary } from "./database/thread-summaries";

export interface StreamingMessageWrite {
  snapshot: ConversationSnapshot;
  messageId: string;
  eventType: string;
  detail?: unknown;
  commandId?: string;
}

export type StreamingMessageResult = { revision: number } | { error: unknown };

export class OpenBotDatabase {
  readonly #core: DatabaseCore;
  readonly usage: AgentUsage;
  readonly #conversations: ConversationQueries;
  readonly #roster: AgentRoster;
  readonly #conversationWrites: ConversationWriter;
  readonly #replay: ThreadReplay;
  readonly #hostedSiteEvents: HostedSiteEventLog;
  readonly #mailbox: MailboxProjection;
  readonly #sessions: ProviderSessions;
  readonly #agentHistory: AgentHistoryQueries;
  readonly #providerHistory: ProviderHistoryStore;
  readonly #summaries: ThreadSummaries;
  readonly #threadEvents: ThreadEventCompaction;

  constructor(
    readonly userDataPath: string,
    checkIntegrity?: DatabaseCoreOptions["checkIntegrity"],
  ) {
    this.#core = new DatabaseCore({ userDataPath, checkIntegrity });
    this.usage = new AgentUsage(this.#core);
    this.#conversations = new ConversationQueries({ core: this.#core });
    this.#roster = new AgentRoster({ core: this.#core });
    this.#conversationWrites = new ConversationWriter({ core: this.#core, roster: this.#roster });
    this.#replay = new ThreadReplay({ core: this.#core, conversations: this.#conversations });
    this.#hostedSiteEvents = new HostedSiteEventLog({ core: this.#core });
    this.#mailbox = new MailboxProjection({ core: this.#core });
    this.#agentHistory = new AgentHistoryQueries(this.#core);
    this.#sessions = new ProviderSessions({ core: this.#core });
    this.#providerHistory = new ProviderHistoryStore({ core: this.#core });
    this.#summaries = new ThreadSummaries({ core: this.#core });
    this.#threadEvents = new ThreadEventCompaction({ core: this.#core });
  }

  get path(): string {
    return this.#core.path;
  }

  initialize() {
    return this.#core.initialize();
  }

  close(): void {
    this.#core.close();
  }

  get connection(): DatabaseSync {
    return this.#core.connection;
  }

  dispatch<T>(
    commandId: string,
    events: OrchestrationEventInput[],
    project: (db: DatabaseSync, sequences: number[]) => T,
  ): T {
    return this.#core.dispatch(commandId, events, project);
  }

  commandResult(commandId: string): unknown | undefined {
    return this.#core.commandResult(commandId);
  }

  hasAggregateEvents(aggregateType: string, aggregateId: string): boolean {
    return this.#core.hasAggregateEvents(aggregateType, aggregateId);
  }

  backupLegacyFile(path: string) {
    return this.#core.backupLegacyFile(path);
  }

  recordPendingHostedSiteTerminalEvent(event: PendingHostedSiteTerminalEvent): void {
    this.#hostedSiteEvents.recordPendingHostedSiteTerminalEvent(event);
  }

  pendingHostedSiteTerminalEvents(): PendingHostedSiteTerminalEvent[] {
    return this.#hostedSiteEvents.pendingHostedSiteTerminalEvents();
  }

  deletePendingHostedSiteTerminalEvent(
    agentId: string,
    operationId: string,
    status: Exclude<HostedSiteConversationEventStatus, "running">,
  ): void {
    this.#hostedSiteEvents.deletePendingHostedSiteTerminalEvent(agentId, operationId, status);
  }

  recordActiveHostedSiteConversationEvent(event: ActiveHostedSiteConversationEvent): void {
    this.#hostedSiteEvents.recordActiveHostedSiteConversationEvent(event);
  }

  deleteActiveHostedSiteConversationEvent(agentId: string, operationId: string): void {
    this.#hostedSiteEvents.deleteActiveHostedSiteConversationEvent(agentId, operationId);
  }

  activeHostedSiteConversationEvents(): ActiveHostedSiteConversationEvent[] {
    return this.#hostedSiteEvents.activeHostedSiteConversationEvents();
  }

  listAgents(): AgentSummary[] {
    return this.#roster.listAgents();
  }

  unclaimedThreads(): { threadId: string; agentId: string }[] {
    return this.#roster.unclaimedThreads();
  }

  latestRosterAgents(): unknown[] {
    return this.#roster.latestRosterAgents();
  }

  replaceAgents(commandId: string, agents: AgentSummary[], eventType: string, modelChange?: AgentModelChange): void {
    this.#roster.replaceAgents(commandId, agents, eventType, modelChange);
  }

  hardDeleteAgent(commandId: string, agentId: string, threadId: string | null, remainingAgents: AgentSummary[]): void {
    this.#roster.hardDeleteAgent(commandId, agentId, threadId, remainingAgents);
  }

  readConversation(agentId: string, threadId: string | null): ConversationSnapshot {
    return this.#conversations.readConversation(agentId, threadId);
  }

  readTurnConversation(agentId: string, threadId: string, turnId: string): ConversationSnapshot {
    return this.#conversations.readTurnConversation(agentId, threadId, turnId);
  }

  readLatestTurnId(turnIds: string[]): string | null {
    return this.#conversations.readLatestTurnId(turnIds);
  }

  readTurnAssistantMessages(agentId: string, turnId: string): ConversationMessage[] {
    return this.#conversations.readTurnAssistantMessages(agentId, turnId);
  }

  readActiveTurnId(agentId: string, threadId: string | null): string | null {
    return this.#conversations.readActiveTurnId(agentId, threadId);
  }

  readRunningTurnIds(): Map<string, string[]> {
    return this.#conversations.readRunningTurnIds();
  }

  readConversationRevision(agentId: string, threadId: string | null): number {
    return this.#conversations.readConversationRevision(agentId, threadId);
  }

  readConversationRuntime(
    agentId: string,
    threadId: string | null,
  ): { activeTurnId: string | null; latestMessage: ConversationMessage | null } {
    return this.#conversations.readConversationRuntime(agentId, threadId);
  }

  readAgentHistory(agentId: string, threadId: string, selection: AgentHistorySelection) {
    return this.#agentHistory.read(agentId, threadId, selection);
  }

  readTurnTrace(threadId: string, turnId: string) {
    return this.#agentHistory.turnTrace(threadId, turnId);
  }

  readConversationMessages(
    agentId: string,
    threadId: string | null,
    messageIds: readonly string[],
  ): ConversationMessage[] {
    return this.#conversations.readConversationMessages(agentId, threadId, messageIds);
  }

  readConversationMessagesOfItemType(agentId: string, threadId: string, itemType: string): ConversationMessage[] {
    return this.#conversations.readConversationMessagesOfItemType(agentId, threadId, itemType);
  }

  readConversationRecoveryMessages(
    agentId: string,
    threadId: string | null,
    activeTurnId: string | null,
  ): ConversationMessage[] {
    return this.#conversations.readConversationRecoveryMessages(agentId, threadId, activeTurnId);
  }

  conversationCursorAt(threadId: string, messageId: string): string | null {
    return this.#conversations.conversationCursorAt(threadId, messageId);
  }

  conversationCountBefore(threadId: string, messageId: string, options: ConversationMarkerExclusions = {}): number {
    return this.#conversations.conversationCountBefore(threadId, messageId, options);
  }

  conversationHasAfter(threadId: string, messageId: string, options: ConversationMarkerExclusions = {}): boolean {
    return this.#conversations.conversationHasAfter(threadId, messageId, options);
  }

  readConversationPage(
    agentId: string,
    threadId: string | null,
    anchor: ConversationPageAnchor = { type: "latest" },
    requestedLimit = 50,
    options: ConversationMarkerExclusions = {},
  ): ConversationPage {
    return this.#conversations.readConversationPage(agentId, threadId, anchor, requestedLimit, options);
  }

  supportedConversationCursor(
    threadId: string,
    throughMessageId: string | null,
    options: ConversationMarkerExclusions = {},
  ): string | null {
    return this.#conversations.supportedConversationCursor(threadId, throughMessageId, options);
  }

  searchConversationMessages(
    query: string,
    agentId?: string,
    cursor?: string,
    requestedLimit = 100,
    includeSideThreads = false,
  ): ConversationSearchPage {
    return this.#conversations.searchConversationMessages(query, agentId, cursor, requestedLimit, includeSideThreads);
  }

  searchConversationFiles(query: string, cursor?: string, requestedLimit = 50): ConversationFileSearchPage {
    return this.#conversations.searchConversationFiles(query, cursor, requestedLimit);
  }

  readSentMessageStats(): SentMessageStats {
    return this.#conversations.readSentMessageStats();
  }

  persistConversation(
    snapshot: ConversationSnapshot,
    eventType: string,
    payload: unknown = {},
    commandId = `conversation:${eventType}:${randomUUID()}`,
  ): ConversationSnapshot {
    return perfTimed("db.persistConversation", () =>
      this.#conversationWrites.persistConversation(snapshot, eventType, payload, commandId),
    );
  }

  persistStreamingMessage(input: StreamingMessageWrite): number {
    return perfTimed("db.persistStreamingMessage", () => this.#conversationWrites.persistStreamingMessage(input));
  }

  persistStreamingMessages(inputs: readonly StreamingMessageWrite[]): StreamingMessageResult[] {
    const db = this.connection;
    return withTransaction(db, () =>
      inputs.map((input): StreamingMessageResult => {
        try {
          return { revision: this.#conversationWrites.persistStreamingMessage(input) };
        } catch (error) {
          if (!db.isTransaction) throw error;
          return { error };
        }
      }),
    );
  }

  appendConversationMessage(input: {
    agentId: string;
    threadId: string;
    activeTurnId: string | null;
    message: ConversationMessage;
    eventType: string;
    detail?: unknown;
    commandId?: string;
  }): number {
    return this.#conversationWrites.appendConversationMessage(input);
  }

  changedConversationMessages(
    threadId: string,
    messages: readonly ConversationMessage[],
    known?: ReadonlyMap<string, ConversationMessage>,
  ): ConversationMessage[] {
    return this.#conversationWrites.changedConversationMessages(threadId, messages, known);
  }

  persistConversationChanges(input: {
    agentId: string;
    threadId: string;
    activeTurnId: string | null;
    changedMessages: readonly ConversationMessage[];
    removedMessageIds?: readonly string[];
    eventType: string;
    detail?: unknown;
    commandId?: string;
    deletedMessageIds?: readonly string[];
    keepMessageTimes?: boolean;
  }): number {
    return this.#conversationWrites.persistConversationChanges(input);
  }

  deleteThreadHistory(input: { agentId: string; threadId: string }): number {
    return this.#conversationWrites.deleteThreadHistory(input);
  }

  threadMessageIds(threadId: string): string[] {
    return threadMessageIds(this.connection, threadId);
  }

  deletedConversationMessageIds(threadId: string): Set<string> {
    return deletedThreadMessageIds(this.connection, threadId);
  }

  pinnedThreadMessages(threadIds: readonly string[], limit: number): PinnedThreadMessage[] {
    return pinnedThreadMessages(this.connection, threadIds, limit);
  }

  pinnedThreadMessageCount(threadId: string): number {
    return pinnedThreadMessageCount(this.connection, threadId);
  }

  threadMessagePinner(threadId: string, messageId: string): MessagePinner | null {
    return threadMessagePinner(this.connection, threadId, messageId);
  }

  pinThreadMessage(threadId: string, messageId: string, pinnedAt: string, pinnedBy: MessagePinner): void {
    pinThreadMessage(this.connection, threadId, messageId, pinnedAt, pinnedBy);
  }

  unpinThreadMessage(threadId: string, messageId: string): void {
    unpinThreadMessage(this.connection, threadId, messageId);
  }

  threadMessagesContaining(threadId: string, quote: string, limit: number): ConversationMessage[] {
    return threadMessagesContaining(this.connection, threadId, quote, limit);
  }

  upsertProviderHistoryMessage(input: {
    agentId: string;
    threadId: string;
    activeTurnId?: string | null;
    message: ConversationMessage;
    eventType?: string;
    detail?: unknown;
    commandId?: string;
  }): number {
    return this.#conversationWrites.upsertProviderHistoryMessage(input);
  }

  importProviderHistoryMessages(input: {
    sessionId: string;
    turnId: string;
    agentId: string;
    threadId: string;
    messages: readonly ConversationMessage[];
    throughItemIndex?: number;
    complete: boolean;
    compact?: boolean;
    detail?: unknown;
  }): void {
    withTransaction(this.connection, () => {
      for (const message of input.messages) {
        this.upsertProviderHistoryMessage({
          agentId: input.agentId,
          threadId: input.threadId,
          message,
          eventType: "provider-history.message-imported",
          detail: input.detail,
        });
      }
      if (input.throughItemIndex !== undefined) {
        this.#providerHistory.markItemsImportedThrough(input.sessionId, input.turnId, input.throughItemIndex);
      }
      if (input.complete) {
        this.#providerHistory.markTurnImported(input.sessionId, input.turnId);
        if (input.compact) this.#providerHistory.compactImportedTurn(input.sessionId, input.turnId);
      }
    });
  }

  persistConversationAndMailbox(
    snapshot: ConversationSnapshot,
    eventType: string,
    payload: unknown,
    mailboxState: MailboxProjectionState,
    mailboxEventType: string,
  ): ConversationSnapshot {
    return withTransaction(this.connection, () => {
      this.replaceMailboxState(`mailbox:${mailboxEventType}:${randomUUID()}`, mailboxState, mailboxEventType);
      return this.#conversationWrites.persistConversation(
        snapshot,
        eventType,
        payload,
        `conversation:${eventType}:${randomUUID()}`,
      );
    });
  }

  persistConversationChangesAndMailbox(
    snapshot: ConversationSnapshot,
    changedMessages: readonly ConversationMessage[],
    eventType: string,
    payload: unknown,
    mailboxState: MailboxProjectionState,
    mailboxChanges: MailboxProjectionChanges,
    mailboxEventType: string,
  ): ConversationSnapshot {
    return withTransaction(this.connection, () => {
      this.applyMailboxChanges(
        `mailbox:${mailboxEventType}:${randomUUID()}`,
        mailboxState,
        mailboxChanges,
        mailboxEventType,
      );
      if (!snapshot.threadId) return structuredClone(snapshot);
      const revision = this.#conversationWrites.persistConversationChanges({
        agentId: snapshot.agentId,
        threadId: snapshot.threadId,
        activeTurnId: snapshot.activeTurnId,
        changedMessages,
        eventType,
        detail: payload,
        commandId: `conversation:${eventType}:${randomUUID()}`,
      });
      return { ...structuredClone(snapshot), revision };
    });
  }

  persistMailboxChangesWith<T>(
    mailboxState: MailboxProjectionState,
    mailboxChanges: MailboxProjectionChanges,
    mailboxEventType: string,
    write: () => T,
  ): T {
    return withTransaction(this.connection, () => {
      this.applyMailboxChanges(
        `mailbox:${mailboxEventType}:${randomUUID()}`,
        mailboxState,
        mailboxChanges,
        mailboxEventType,
      );
      return write();
    });
  }

  activeProviderSession(threadId: string, provider: AgentProviderId): ProviderSession | null {
    return this.#sessions.activeProviderSession(threadId, provider);
  }

  threadHasEvent(threadId: string, eventType: string): boolean {
    return (
      this.connection
        .prepare(
          `SELECT 1 FROM orchestration_events
           WHERE aggregate_type = 'thread' AND aggregate_id = ? AND event_type = ? LIMIT 1`,
        )
        .get(threadId, eventType) !== undefined
    );
  }

  listProviderSessions(threadId: string): ProviderSession[] {
    return this.#sessions.listProviderSessions(threadId);
  }

  listProviderSessionIds(externalSessionId?: string): string[] {
    return this.#sessions.listProviderSessionIds(externalSessionId);
  }

  listExternalSessionIds(): string[] {
    return this.#sessions.listExternalSessionIds();
  }

  activeProviderSessionThreads(agentId: string): string[] {
    return this.#sessions.activeProviderSessionThreads(agentId);
  }

  bindProviderSession(input: {
    threadId: string;
    provider: AgentProviderId;
    externalSessionId: string;
    model: string;
    effort: string;
    resumeCursor?: string | null;
  }): ProviderSession {
    return this.#sessions.bindProviderSession(input);
  }

  deactivateProviderSessions(threadId: string): void {
    this.#sessions.deactivateProviderSessions(threadId);
  }

  updateProviderSessionConfig(sessionId: string, threadId: string, model: string, effort: string): void {
    this.#sessions.updateProviderSessionConfig(sessionId, threadId, model, effort);
  }

  ensureProviderHistoryImport(input: ProviderHistorySessionInput): ProviderHistoryImportState {
    return this.#providerHistory.ensureImport(input);
  }

  stageProviderHistoryFragment(input: {
    sessionId: string;
    fragment: import("./provider-history").ProviderHistoryFragment;
    cursor?: unknown;
  }): ProviderHistoryStageResult {
    return this.#providerHistory.stageProviderHistoryFragment(input);
  }

  providerHistoryImport(sessionId: string): ProviderHistoryImportState | null {
    return this.#providerHistory.readImport(sessionId);
  }

  stagedProviderHistoryTurns(sessionId: string, limit = 50): ProviderHistoryStagedTurn[] {
    return this.#providerHistory.readStagedTurns(sessionId, limit);
  }

  stagedProviderHistoryTurnPage(
    sessionId: string,
    input: { after?: ProviderHistoryTurnCursor; limit?: number } = {},
  ): ProviderHistoryStagedTurnPage {
    return this.#providerHistory.readStagedTurnPage(sessionId, input);
  }

  stagedProviderHistoryItems(input: {
    sessionId: string;
    turnId: string;
    afterIndex?: number;
    limit?: number;
    pendingOnly?: boolean;
  }): ProviderHistoryStagedItem[] {
    return this.#providerHistory.readStagedItems(input);
  }

  compactImportedProviderHistory(afterRowId: number): ProviderHistoryCompactionBatch {
    return this.#providerHistory.compactImportedItems(afterRowId);
  }

  compactThreadEvents(): ThreadEventCompactionBatch {
    return this.#threadEvents.compactNext();
  }

  dropCompactedProviderHistoryItems(sessionId: string, turnId: string): void {
    this.#providerHistory.dropCompactedItems(sessionId, turnId);
  }

  markProviderHistoryTurnImported(sessionId: string, turnId: string): void {
    this.#providerHistory.markTurnImported(sessionId, turnId);
  }

  markProviderHistoryImportState(
    sessionId: string,
    state: ProviderHistoryImportState["state"],
    cursor?: unknown,
  ): void {
    this.#providerHistory.markImportState(sessionId, state, cursor);
  }

  saveThreadSummary(
    threadId: string,
    throughMessageId: string | null,
    text: string,
    estimatedTokens: number,
  ): StoredThreadSummary {
    return this.#summaries.saveThreadSummary(threadId, throughMessageId, text, estimatedTokens);
  }

  latestThreadSummary(threadId: string): StoredThreadSummary | null {
    return this.#summaries.latestThreadSummary(threadId);
  }

  rebuildThreadProjection(threadId: string): ConversationSnapshot {
    return this.#replay.rebuildThreadProjection(threadId);
  }

  replaceMailboxState(
    commandId: string,
    state: MailboxProjectionState,
    eventType: string,
    fileDeletions: string[] = [],
    rebaseHistory = false,
  ): boolean {
    return this.#mailbox.replaceMailboxState(commandId, state, eventType, fileDeletions, rebaseHistory);
  }

  applyMailboxChanges(
    commandId: string,
    state: MailboxProjectionState,
    changes: MailboxProjectionChanges,
    eventType: string,
    fileDeletions: string[] = [],
    writeIdempotency = true,
  ): boolean {
    return this.#mailbox.applyMailboxChanges(commandId, state, changes, eventType, fileDeletions, writeIdempotency);
  }

  pendingFileDeletions(): Array<{ id: string; path: string }> {
    return this.#mailbox.pendingFileDeletions();
  }

  completeFileDeletion(id: string): void {
    this.#mailbox.completeFileDeletion(id);
  }

  failFileDeletion(id: string, error: string): void {
    this.#mailbox.failFileDeletion(id, error);
  }

  readMailboxState(): unknown | null {
    return this.#mailbox.readMailboxState();
  }
}

export function stableThreadId(agentId: string): string {
  return `openbot-thread-${agentId}`;
}
