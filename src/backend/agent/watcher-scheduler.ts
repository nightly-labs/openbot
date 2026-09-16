import { randomUUID } from "node:crypto";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentEvent,
  ConversationMessage,
  CreateWatcherInput,
  DeleteWatcherInput,
  UpdateWatcherInput,
  Watcher,
  WatcherCondition,
  WatcherConversationEventAction,
  WatcherSelector,
  WatcherSource,
} from "@openbot/contracts/ipc";
import {
  isWatcherCondition,
  isWatcherSelector,
  isWatcherSource,
  watcherConversationEventItemType,
} from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { AgentWatcherStore } from "../agent-watcher-store";
import { sortConversationMessages } from "../conversation-snapshots";
import type { OpenBotDatabase } from "../openbot-database";
import type { DynamicToolCallParams } from "../protocol";
import type { RoutineDueSource, RoutineTimer } from "../routine-timer";
import {
  diffWatcherBlocks,
  filterWatcherNoise,
  hashWatcherBlocks,
  hashWatcherState,
  isThinWatcherText,
  scopeWatcherText,
  splitWatcherBlocks,
  truncateWatcherDiff,
  watcherMatchPrefix,
  watcherTextMatches,
} from "../watcher-content";
import { readWatcherSource, type WatcherFacts, type WatcherSourceDeps } from "../watcher-sources";
import type { ConversationRuntime } from "./conversation-runtime";
import {
  type OpenBotToolResponse,
  openBotToolResult,
  routineToolAgentId,
  routineToolArguments,
  routineToolString,
} from "./routine-tools";

export interface WatcherSchedulerHooks {
  emit(event: AgentEvent): void;
  emitError(code: string, error: unknown, agentId?: string): void;
  excludedAgents(): ReadonlySet<string>;
  isRunning(): boolean;
  /** Starts the linked routine and returns the run id. Reuses the manual routine path. */
  fireRoutine(agentId: string, routineId: string, context: string): Promise<string>;
  requireKnownAgent(agentId: string): void;
}

export interface WatcherSchedulerOptions {
  database: OpenBotDatabase;
  timer: RoutineTimer;
  hooks: WatcherSchedulerHooks;
  conversation: ConversationRuntime;
  sources?: WatcherSourceDeps;
}

/**
 * Owns cheap outside checks for one agent's watchers. It never runs the LLM itself. On a real
 * match it records the match, fires the linked routine once, and links the match to that run.
 * Idle polls write check state only, so they cost zero tokens.
 */
export class WatcherScheduler implements RoutineDueSource {
  readonly #watchers: AgentWatcherStore;
  readonly #database: OpenBotDatabase;
  readonly #timer: RoutineTimer;
  readonly #hooks: WatcherSchedulerHooks;
  readonly #conversation: ConversationRuntime;
  readonly #sources: WatcherSourceDeps;

  constructor(options: WatcherSchedulerOptions) {
    this.#watchers = new AgentWatcherStore(options.database);
    this.#database = options.database;
    this.#timer = options.timer;
    this.#hooks = options.hooks;
    this.#conversation = options.conversation;
    this.#sources = options.sources ?? {};
  }

  get store(): AgentWatcherStore {
    return this.#watchers;
  }

  create(input: CreateWatcherInput): Watcher {
    this.#hooks.requireKnownAgent(input.agentId);
    const watcher = this.#watchers.create(input);
    this.#hooks.emit({ type: "watchers-changed", agentId: input.agentId });
    this.arm();
    return watcher;
  }

  update(input: UpdateWatcherInput): Watcher {
    this.#hooks.requireKnownAgent(input.agentId);
    const before = this.#watchers.get(input.agentId, input.watcherId);
    const watcher = this.#watchers.update(input);
    if (before && before.active !== watcher.active)
      this.#appendLifecycleEvent(watcher, watcher.active ? "resumed" : "paused");
    this.#hooks.emit({ type: "watchers-changed", agentId: input.agentId });
    this.arm();
    return watcher;
  }

  delete(input: DeleteWatcherInput): void {
    this.#hooks.requireKnownAgent(input.agentId);
    this.#watchers.delete(input.agentId, input.watcherId);
    this.#hooks.emit({ type: "watchers-changed", agentId: input.agentId });
    this.arm();
  }

  /** Pause or resume with a chat marker, like routine create and delete show one. */
  setActive(agentId: string, watcherId: string, active: boolean): Watcher {
    return this.update({ agentId, watcherId, active });
  }

  arm(): void {
    this.#timer.arm();
  }

  nextDueAt(): string | null {
    return this.#watchers.nextDueAt(this.#hooks.excludedAgents());
  }

  async processDue(now = new Date()): Promise<void> {
    const changedAgents = new Set<string>();
    try {
      for (const watcher of this.#watchers.due(now, this.#hooks.excludedAgents())) {
        if (this.#hooks.excludedAgents().has(watcher.agentId)) continue;
        try {
          this.#hooks.requireKnownAgent(watcher.agentId);
        } catch {
          continue;
        }
        const fired = await this.#checkWatcher(watcher, now).catch((error) => {
          this.#hooks.emitError("watcher_check_failed", error, watcher.agentId);
          this.#watchers.recordCheck(watcher, { stateHash: null, error: String(error) }, now);
          return false;
        });
        changedAgents.add(watcher.agentId);
        if (fired) changedAgents.add(watcher.agentId);
      }
    } catch (error) {
      this.#hooks.emitError("watcher_scheduler_failed", error);
    } finally {
      for (const agentId of changedAgents) this.#hooks.emit({ type: "watchers-changed", agentId });
    }
  }

  async checkNow(watcher: Watcher, now = new Date()): Promise<{ matched: boolean; checked: Watcher }> {
    const due: Watcher = { ...watcher, nextCheckAt: now.toISOString() };
    const fired = await this.#checkWatcher(due, now, { baseline: false });
    const checked = this.#watchers.get(watcher.agentId, watcher.id) ?? watcher;
    return { matched: fired, checked };
  }

  #appendLifecycleEvent(watcher: Watcher, action: WatcherConversationEventAction): void {
    this.#conversation.withConversationTransaction(watcher.agentId, ({ snapshot: nextSnapshot }) => {
      const message: ConversationMessage = {
        id: randomUUID(),
        author: "system",
        source: "system",
        text: watcher.name,
        createdAt: new Date().toISOString(),
        status: "completed",
        itemType: watcherConversationEventItemType(action, watcher.id),
      };
      nextSnapshot.messages.push(message);
      sortConversationMessages(nextSnapshot.messages);
      const persisted = this.#database.persistConversation(nextSnapshot, `watcher.${action}`, {
        action,
        watcherId: watcher.id,
        watcherName: watcher.name,
        messageId: message.id,
      });
      return { result: undefined, snapshot: persisted };
    });
  }

  /** The six `openbot` watcher tools. Returns null when `tool` is not one of them. */
  async handleTool(params: DynamicToolCallParams, senderAgentId: string): Promise<OpenBotToolResponse | null> {
    if (params.tool === "list_watchers") {
      const args = routineToolArguments(params.arguments, ["agentId"]);
      return openBotToolResult({ watchers: this.#watchers.list(routineToolAgentId(args, senderAgentId)) });
    }
    if (params.tool === "create_watcher") {
      const args = routineToolArguments(params.arguments, [
        "agentId",
        "routineId",
        "name",
        "source",
        "intervalMinutes",
        "active",
        "selector",
        "condition",
      ]);
      const agentId = routineToolAgentId(args, senderAgentId);
      const watcher = this.create({
        agentId,
        routineId: routineToolString(args.routineId, "routineId", INPUT_LIMITS.identifier, "routineId is required."),
        name: routineToolString(args.name, "name", INPUT_LIMITS.watcherName, "A watcher name is required."),
        active: args.active === undefined ? true : parseWatcherBoolean(args.active),
        intervalMinutes: parseWatcherInterval(args.intervalMinutes),
        source: parseWatcherSource(args.source),
        selector: parseWatcherSelector(args.selector),
        condition: parseWatcherCondition(args.condition),
      });
      return openBotToolResult(watcher);
    }
    if (params.tool === "update_watcher") {
      const args = routineToolArguments(params.arguments, [
        "agentId",
        "watcherId",
        "name",
        "intervalMinutes",
        "active",
        "source",
        "selector",
        "condition",
      ]);
      const agentId = routineToolAgentId(args, senderAgentId);
      const watcher = this.update({
        agentId,
        watcherId: routineToolString(args.watcherId, "watcherId", INPUT_LIMITS.identifier, "watcherId is required."),
        ...(args.name === undefined
          ? {}
          : { name: routineToolString(args.name, "name", INPUT_LIMITS.watcherName, "A watcher name is required.") }),
        ...(args.intervalMinutes === undefined ? {} : { intervalMinutes: parseWatcherInterval(args.intervalMinutes) }),
        ...(args.active === undefined ? {} : { active: parseWatcherBoolean(args.active) }),
        ...(args.source === undefined ? {} : { source: parseWatcherSource(args.source) }),
        ...(args.selector === undefined ? {} : { selector: parseWatcherSelector(args.selector) }),
        ...(args.condition === undefined ? {} : { condition: parseWatcherCondition(args.condition) }),
      });
      return openBotToolResult(watcher);
    }
    if (params.tool === "pause_watcher" || params.tool === "resume_watcher") {
      const args = routineToolArguments(params.arguments, ["agentId", "watcherId"]);
      const agentId = routineToolAgentId(args, senderAgentId);
      const watcher = this.setActive(
        agentId,
        routineToolString(args.watcherId, "watcherId", INPUT_LIMITS.identifier, "watcherId is required."),
        params.tool === "resume_watcher",
      );
      return openBotToolResult(watcher);
    }
    if (params.tool === "delete_watcher") {
      const args = routineToolArguments(params.arguments, ["agentId", "watcherId"]);
      const agentId = routineToolAgentId(args, senderAgentId);
      this.delete({
        agentId,
        watcherId: routineToolString(args.watcherId, "watcherId", INPUT_LIMITS.identifier, "watcherId is required."),
      });
      return openBotToolResult({ deleted: true });
    }
    if (params.tool === "test_watcher") {
      const args = routineToolArguments(params.arguments, ["agentId", "watcherId"]);
      const agentId = routineToolAgentId(args, senderAgentId);
      const watcherId = routineToolString(
        args.watcherId,
        "watcherId",
        INPUT_LIMITS.identifier,
        "watcherId is required.",
      );
      const watcher = this.#watchers.get(agentId, watcherId);
      if (!watcher) throw new Error("This watcher no longer exists.");
      await this.checkNow(watcher);
      return openBotToolResult({ matches: this.#watchers.listMatches(agentId, watcherId, 10) });
    }
    if (params.tool === "list_watcher_matches") {
      const args = routineToolArguments(params.arguments, ["agentId", "watcherId", "limit"]);
      const agentId = routineToolAgentId(args, senderAgentId);
      const watcherId = routineToolString(
        args.watcherId,
        "watcherId",
        INPUT_LIMITS.identifier,
        "watcherId is required.",
      );
      return openBotToolResult({ matches: this.#watchers.listMatches(agentId, watcherId, 10) });
    }
    return null;
  }

  async #checkWatcher(
    watcher: Watcher,
    now: Date,
    options: { baseline: boolean } = { baseline: true },
  ): Promise<boolean> {
    let facts: WatcherFacts[];
    try {
      facts = await readWatcherSource(watcher.source, this.#sources);
    } catch (error) {
      this.#watchers.recordCheck(
        watcher,
        {
          stateHash: null,
          mode: watcher.source.kind === "gmail" ? "gmail" : "fetch",
          error: error instanceof Error ? error.message : String(error),
        },
        now,
      );
      return false;
    }
    if (facts.length === 0) {
      this.#watchers.recordCheck(
        watcher,
        {
          stateHash: watcher.lastStateHash,
          mode: watcher.source.kind === "gmail" ? "gmail" : "fetch",
          weak: watcher.source.kind === "gmail",
        },
        now,
      );
      return false;
    }
    const textContains = watcher.condition.textContains;
    if (watcher.source.kind === "gmail") {
      let fired = false;
      let runId: string | null = null;
      for (const fact of facts) {
        if (!watcherTextMatches(fact.text, textContains)) continue;
        const match = this.#watchers.recordMatch(
          watcher,
          fact.sourceId,
          fact.summary,
          truncateWatcherDiff(fact.text),
          now,
        );
        if (!match) continue;
        try {
          runId ??= await this.#hooks.fireRoutine(
            watcher.agentId,
            watcher.routineId,
            watcherMatchPrefix(watcher.name, match.summary, match.diff),
          );
          this.#watchers.markMatchConsumed(match.id, runId);
          fired = true;
        } catch (error) {
          this.#hooks.emitError("watcher_delivery_failed", error, watcher.agentId);
        }
      }
      const stateHash = hashWatcherState(facts.map((fact) => fact.sourceId).join("\n"));
      this.#watchers.recordCheck(watcher, { stateHash, mode: "gmail" }, now);
      return fired;
    }
    const fact = facts[0];
    if (!fact) {
      this.#watchers.recordCheck(watcher, { stateHash: watcher.lastStateHash, mode: "fetch" }, now);
      return false;
    }
    const mode = fact.mode;
    const kept = filterWatcherNoise(fact.text);
    const keptOrRaw = !isThinWatcherText(kept) || isThinWatcherText(fact.text) ? kept : fact.text;
    const scope = scopeWatcherText(keptOrRaw, watcher.selector?.textAnchor);
    const scoped = scope.text;
    const anchorMissing = (watcher.selector?.textAnchor?.trim().length ?? 0) > 0 && !scope.scoped;
    const weak = keptOrRaw !== kept || anchorMissing;
    if (isThinWatcherText(scoped) && fact.shell) {
      this.#watchers.recordCheck(
        watcher,
        { stateHash: watcher.lastStateHash, keptText: watcher.lastKeptText, mode, weak: true },
        now,
      );
      return false;
    }
    const blocks = splitWatcherBlocks(scoped);
    const stateHash = hashWatcherBlocks(blocks);
    const knownFormat = watcher.lastStateHash?.startsWith("v2:") ?? false;
    if (options.baseline && (!knownFormat || watcher.lastStateHash === null)) {
      this.#watchers.recordCheck(watcher, { stateHash, keptText: scoped, mode, weak }, now);
      return false;
    }
    if (watcher.lastStateHash === stateHash) {
      this.#watchers.recordCheck(watcher, { stateHash, keptText: scoped, mode, weak }, now);
      return false;
    }
    if (!watcherTextMatches(scoped, textContains)) {
      this.#watchers.recordCheck(watcher, { stateHash, keptText: scoped, mode, weak }, now);
      return false;
    }
    const priorBlocks = watcher.lastKeptText ? splitWatcherBlocks(watcher.lastKeptText) : [];
    const diff = diffWatcherBlocks(priorBlocks, blocks) || truncateWatcherDiff(scoped);
    const match = this.#watchers.recordMatch(watcher, stateHash, fact.summary, diff, now);
    if (!match) {
      this.#watchers.recordCheck(watcher, { stateHash, keptText: scoped, mode, weak }, now);
      return false;
    }
    try {
      const runId = await this.#hooks.fireRoutine(
        watcher.agentId,
        watcher.routineId,
        watcherMatchPrefix(watcher.name, match.summary, match.diff),
      );
      this.#watchers.markMatchConsumed(match.id, runId);
    } catch (error) {
      this.#hooks.emitError("watcher_delivery_failed", error, watcher.agentId);
    }
    this.#watchers.recordCheck(watcher, { stateHash, keptText: scoped, mode, weak }, now);
    return true;
  }
}

function parseWatcherBoolean(value: unknown): boolean {
  if (!isBoolean(value)) throw new Error("active must be a boolean.");
  return value;
}

function parseWatcherInterval(value: unknown): number {
  if (value === undefined) return 15;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 3 || value > 1440) {
    throw new Error("Watcher interval must be between 3 and 1440 minutes.");
  }
  return value;
}

function parseWatcherSource(value: unknown): WatcherSource {
  if (!isWatcherSource(value)) throw new Error("Invalid watcher source.");
  return structuredClone(value);
}

function parseWatcherSelector(value: unknown): WatcherSelector | null {
  if (value === undefined || value === null) return null;
  if (!isDynamicRecord(value) || !isWatcherSelector(value)) throw new Error("Invalid watcher selector.");
  return structuredClone(value);
}

function parseWatcherCondition(value: unknown): WatcherCondition {
  if (value === undefined) return {};
  if (!isWatcherCondition(value)) throw new Error("Invalid watcher condition.");
  return structuredClone(value);
}
