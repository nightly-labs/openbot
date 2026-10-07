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
} from "@openbot/contracts/ipc";
import { type AgentModelChange, AgentRoster } from "./database/agent-roster";
import { AgentUsage } from "./database/agent-usage";
import { ConversationQueries } from "./database/conversation-queries";
import { ConversationWriter } from "./database/conversation-writer";
import { DatabaseCore, type OrchestrationEventInput } from "./database/database-core";
import {
  type ActiveHostedSiteConversationEvent,
  HostedSiteEventLog,
  type PendingHostedSiteTerminalEvent,
} from "./database/hosted-site-event-log";
import { MailboxProjection, type MailboxProjectionState } from "./database/mailbox-projection";
import {
  type ProviderHistoryImportState,
  type ProviderHistorySessionInput,
  type ProviderHistoryStagedItem,
  type ProviderHistoryStagedTurn,
  type ProviderHistoryStagedTurnPage,
  ProviderHistoryStore,
  type ProviderHistoryTurnCursor,
} from "./database/provider-history-store";
import { type ProviderSession, ProviderSessions } from "./database/provider-sessions";
import { ThreadReplay } from "./database/thread-replay";
import { type StoredThreadSummary, ThreadSummaries } from "./database/thread-summaries";

// Declared in this module before the split and part of the frozen public surface, so it stays
// reachable from here rather than only from the controller that owns it now. Structural `Pick<...>`
// types over this class do not cover exported types.
export type { OrchestrationEventInput } from "./database/database-core";
export type {
  ActiveHostedSiteConversationEvent,
  PendingHostedSiteTerminalEvent,
} from "./database/hosted-site-event-log";
export type {
  ProviderHistoryImportState,
  ProviderHistorySessionInput,
  ProviderHistoryStagedItem,
  ProviderHistoryStagedTurn,
  ProviderHistoryStagedTurnPage,
  ProviderHistoryTurnCursor,
} from "./database/provider-history-store";
export type { ProviderSession } from "./database/provider-sessions";
export type { StoredThreadSummary } from "./database/thread-summaries";

/**
 * The local OpenBot event log and its read projections.
 *
 * A command appends events, changes projections, and stores its receipt in one
 * SQLite transaction. Providers never receive direct access to this database.
 */
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
  readonly #providerHistory: ProviderHistoryStore;
  readonly #summaries: ThreadSummaries;

  constructor(readonly userDataPath: string) {
    this.#core = new DatabaseCore({ userDataPath });
    this.usage = new AgentUsage(this.#core);
    this.#conversations = new ConversationQueries({ core: this.#core });
    this.#roster = new AgentRoster({ core: this.#core });
    this.#conversationWrites = new ConversationWriter({ core: this.#core, roster: this.#roster });
    this.#replay = new ThreadReplay({ core: this.#core, conversations: this.#conversations });
    this.#hostedSiteEvents = new HostedSiteEventLog({ core: this.#core });
    this.#mailbox = new MailboxProjection({ core: this.#core });
    this.#sessions = new ProviderSessions({ core: this.#core });
    this.#providerHistory = new ProviderHistoryStore({ core: this.#core });
    this.#summaries = new ThreadSummaries({ core: this.#core });
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

  readActiveTurnId(agentId: string, threadId: string | null): string | null {
    return this.#conversations.readActiveTurnId(agentId, threadId);
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

  readConversationMessages(
    agentId: string,
    threadId: string | null,
    messageIds: readonly string[],
  ): ConversationMessage[] {
    return this.#conversations.readConversationMessages(agentId, threadId, messageIds);
  }

  readConversationRecoveryMessages(
    agentId: string,
    threadId: string | null,
    activeTurnId: string | null,
  ): ConversationMessage[] {
    return this.#conversations.readConversationRecoveryMessages(agentId, threadId, activeTurnId);
  }

  readConversationPage(
    agentId: string,
    threadId: string | null,
    anchor: ConversationPageAnchor = { type: "latest" },
    requestedLimit = 50,
    options: {
      excludeRoutineEvents?: boolean;
      excludeRoutineRunEvents?: boolean;
      excludeHostedSiteEvents?: boolean;
    } = {},
  ): ConversationPage {
    return this.#conversations.readConversationPage(agentId, threadId, anchor, requestedLimit, options);
  }

  supportedConversationCursor(
    threadId: string,
    throughMessageId: string | null,
    options: {
      excludeRoutineEvents?: boolean;
      excludeRoutineRunEvents?: boolean;
      excludeHostedSiteEvents?: boolean;
    } = {},
  ): string | null {
    return this.#conversations.supportedConversationCursor(threadId, throughMessageId, options);
  }

  searchConversationMessages(
    query: string,
    agentId?: string,
    cursor?: string,
    requestedLimit = 100,
  ): ConversationSearchPage {
    return this.#conversations.searchConversationMessages(query, agentId, cursor, requestedLimit);
  }

  searchConversationFiles(query: string, cursor?: string, requestedLimit = 50): ConversationFileSearchPage {
    return this.#conversations.searchConversationFiles(query, cursor, requestedLimit);
  }

  persistConversation(
    snapshot: ConversationSnapshot,
    eventType: string,
    payload: unknown = {},
    commandId = `conversation:${eventType}:${randomUUID()}`,
  ): ConversationSnapshot {
    return this.#conversationWrites.persistConversation(snapshot, eventType, payload, commandId);
  }

  /** Writes one message of a thread, for a caller that knows only that message changed. */
  persistStreamingMessage(input: {
    snapshot: ConversationSnapshot;
    messageId: string;
    eventType: string;
    detail?: unknown;
    commandId?: string;
  }): number {
    return this.#conversationWrites.persistStreamingMessage(input);
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

  persistConversationChanges(input: {
    agentId: string;
    threadId: string;
    activeTurnId: string | null;
    changedMessages: readonly ConversationMessage[];
    removedMessageIds?: readonly string[];
    eventType: string;
    detail?: unknown;
    commandId?: string;
  }): number {
    return this.#conversationWrites.persistConversationChanges(input);
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

  /** Commits one normalized provider-history page and its staging marker as one transaction. */
  importProviderHistoryMessages(input: {
    sessionId: string;
    turnId: string;
    agentId: string;
    threadId: string;
    messages: readonly ConversationMessage[];
    throughItemIndex?: number;
    complete: boolean;
    detail?: unknown;
  }): void {
    const db = this.connection;
    const ownsTransaction = !db.isTransaction;
    if (ownsTransaction) db.exec("BEGIN IMMEDIATE");
    try {
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
      if (input.complete) this.#providerHistory.markTurnImported(input.sessionId, input.turnId);
      if (ownsTransaction) db.exec("COMMIT");
    } catch (error) {
      if (ownsTransaction && db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }

  persistConversationAndMailbox(
    snapshot: ConversationSnapshot,
    eventType: string,
    payload: unknown,
    mailboxState: MailboxProjectionState,
    mailboxEventType: string,
  ): ConversationSnapshot {
    const db = this.connection;
    db.exec("BEGIN IMMEDIATE");
    try {
      this.replaceMailboxState(`mailbox:${mailboxEventType}:${randomUUID()}`, mailboxState, mailboxEventType);
      const persisted = this.#conversationWrites.persistConversation(
        snapshot,
        eventType,
        payload,
        `conversation:${eventType}:${randomUUID()}`,
      );
      db.exec("COMMIT");
      return persisted;
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }

  persistConversationChangesAndMailbox(
    snapshot: ConversationSnapshot,
    changedMessages: readonly ConversationMessage[],
    eventType: string,
    payload: unknown,
    mailboxState: MailboxProjectionState,
    mailboxEventType: string,
  ): ConversationSnapshot {
    const db = this.connection;
    db.exec("BEGIN IMMEDIATE");
    try {
      this.replaceMailboxState(`mailbox:${mailboxEventType}:${randomUUID()}`, mailboxState, mailboxEventType);
      if (!snapshot.threadId) {
        db.exec("COMMIT");
        return structuredClone(snapshot);
      }
      const revision = this.#conversationWrites.persistConversationChanges({
        agentId: snapshot.agentId,
        threadId: snapshot.threadId,
        activeTurnId: snapshot.activeTurnId,
        changedMessages,
        eventType,
        detail: payload,
        commandId: `conversation:${eventType}:${randomUUID()}`,
      });
      db.exec("COMMIT");
      return { ...structuredClone(snapshot), revision };
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }

  activeProviderSession(threadId: string, provider: AgentProviderId): ProviderSession | null {
    return this.#sessions.activeProviderSession(threadId, provider);
  }

  listProviderSessions(threadId: string): ProviderSession[] {
    return this.#sessions.listProviderSessions(threadId);
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
  }): ProviderHistoryImportState {
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
  ): void {
    this.#mailbox.replaceMailboxState(commandId, state, eventType, fileDeletions, rebaseHistory);
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
