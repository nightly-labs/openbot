import { randomUUID } from "node:crypto";
import {
  type AgentEvent,
  type AgentSummary,
  agentMarketplacePictureKey,
  type SidebarLayoutSnapshot,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Result, Schema } from "effect";
import type { AgentService } from "../agent-service";
import { type AgentStore, duplicationProfileSignature } from "../agent-store";
import { causeHelpers } from "../effect-boundary";
import type { MailboxStore } from "../mailbox-store";
import type { SidebarLayoutStore } from "../sidebar-layout-store";
import type { AgentMemories } from "./agent-memories";
import type { ConversationRuntime } from "./conversation-runtime";
import type { RoutineScheduler } from "./routine-scheduler";

export interface DuplicationHooks {
  emit(event: AgentEvent): void;
  listAgents(): AgentSummary[];
  deleteAgentData(agent: AgentSummary): Effect.Effect<void, AgentDuplicationFailed>;
  hasAttentionFor(agentId: string): boolean;
  scheduleDrain(agentId: string): void;
}

export interface DuplicationGateOptions {
  store: AgentStore;
  mailbox: MailboxStore;
  conversation: ConversationRuntime;
  memories: AgentMemories;
  routines: RoutineScheduler;
  hooks: DuplicationHooks;
}

export class DuplicationGate {
  readonly #store: AgentStore;
  readonly #mailbox: MailboxStore;
  readonly #conversation: ConversationRuntime;
  readonly #memories: AgentMemories;
  readonly #routines: RoutineScheduler;
  readonly #hooks: DuplicationHooks;
  readonly #duplicatingAgents = new Set<string>();
  readonly #pendingAgents = new Set<string>();
  readonly #pendingOperations = new Map<string, { operationId: string; sourceAgentId: string }>();
  readonly #pendingReleases = new Map<string, () => void>();
  #commitQueue: Deferred.Deferred<void> | null = null;

  constructor(options: DuplicationGateOptions) {
    this.#store = options.store;
    this.#mailbox = options.mailbox;
    this.#conversation = options.conversation;
    this.#memories = options.memories;
    this.#routines = options.routines;
    this.#hooks = options.hooks;
  }

  mayDrain(agentId: string): boolean {
    return !this.#pendingAgents.has(agentId) && !this.#duplicatingAgents.has(agentId);
  }

  isPending(agentId: string): boolean {
    return this.#pendingAgents.has(agentId);
  }

  pendingAgents(): ReadonlySet<string> {
    return this.#pendingAgents;
  }

  visibleAgents(agents: AgentSummary[]): AgentSummary[] {
    return agents.filter((agent) => !this.#pendingAgents.has(agent.id));
  }

  readonly duplicate = Effect.fn("Agent.duplicate")(function* (
    this: DuplicationGate,
    sourceAgentId: string,
    operationId: string = randomUUID(),
  ) {
    const releaseDuplication = yield* this.#acquireCommitLock();
    let releaseOnExit = true;
    let duplicate: AgentSummary | null = null;
    return yield* Effect.gen({ self: this }, function* () {
      const source = yield* duplicationStep(() => {
        const source = this.#conversation.requireKnownAgent(sourceAgentId);
        if (this.#duplicatingAgents.has(sourceAgentId)) throw new Error(sourceText("error.agent.duplicationBusy"));
        this.assertAgentIdle(sourceAgentId);
        return source;
      });
      const signature = yield* duplicationStep(() => this.#sourceSignature(sourceAgentId));
      this.#duplicatingAgents.add(sourceAgentId);
      duplicate = yield* this.#store.duplicateAgent(sourceAgentId, operationId).pipe(toAgentDuplicationFailed);
      const copied = duplicate;
      let completedDuplicate = copied;
      yield* duplicationStep(() => {
        this.#pendingAgents.add(copied.id);
        this.#pendingOperations.set(copied.id, { operationId, sourceAgentId });
        this.#assertSourceUnchanged(sourceAgentId, signature);
        this.#memories.duplicate(sourceAgentId, copied.id);
        const routines = this.#routines.duplicate(sourceAgentId, copied.id, new Date());
        this.#assertSourceUnchanged(sourceAgentId, signature);
        if (source.marketplaceSource) {
          const profile = source.marketplaceSource.profile;
          completedDuplicate = this.#store.setMarketplaceSource(copied.id, {
            ...structuredClone(source.marketplaceSource),
            ...(profile && profile.picture === agentMarketplacePictureKey(source)
              ? { profile: { ...profile, picture: agentMarketplacePictureKey(copied) } }
              : {}),
            routineIds: source.marketplaceSource.routineIds.flatMap((routineId) => {
              const routine = routines.get(routineId);
              return routine ? [routine.id] : [];
            }),
          });
          duplicate = completedDuplicate;
        }
        this.#assertSourceUnchanged(sourceAgentId, signature);
      });
      return yield* duplicationStep(() => {
        this.#pendingReleases.set(copied.id, releaseDuplication);
        releaseOnExit = false;
        return this.#store.list().find((candidate) => candidate.id === copied.id) ?? completedDuplicate;
      });
    }).pipe(
      Effect.catchDefect((cause) => Effect.fail(new AgentDuplicationFailed({ cause }))),
      Effect.catch((failure) =>
        Effect.gen({ self: this }, function* () {
          if (!duplicate) return yield* failure;
          const abandoned = duplicate;
          const rollback = yield* Effect.result(
            this.#hooks.deleteAgentData(abandoned).pipe(
              toAgentDuplicationFailed,
              Effect.catchDefect((cause) => Effect.fail(new AgentDuplicationFailed({ cause }))),
            ),
          );
          if (Result.isSuccess(rollback)) {
            this.#pendingAgents.delete(abandoned.id);
            this.#pendingOperations.delete(abandoned.id);
          }
          this.#routines.arm();
          if (Result.isFailure(rollback)) {
            return yield* new AgentDuplicationFailed({
              cause: new AggregateError(
                [failure.cause, rollback.failure.cause],
                sourceText("error.agent.duplicateCleanupFailed"),
              ),
            });
          }
          return yield* failure;
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          this.#duplicatingAgents.delete(sourceAgentId);
          this.#hooks.scheduleDrain(sourceAgentId);
          if (releaseOnExit) releaseDuplication();
        }),
      ),
    );
  }, Effect.uninterruptible);

  readonly commit = Effect.fn("Agent.commitDuplication")(function* (
    this: DuplicationGate,
    agentId: string,
    layout: SidebarLayoutSnapshot,
  ) {
    const operation = yield* duplicationStep(() => {
      if (!this.#pendingAgents.has(agentId)) throw new Error("This agent duplication is not pending.");
      const operation = this.#pendingOperations.get(agentId);
      if (!operation) throw new Error("This agent duplication operation is unavailable.");
      return operation;
    });
    const releaseDuplication = this.#pendingReleases.get(agentId);
    return yield* this.#store
      .commitAgentDuplication(agentId, operation.operationId, operation.sourceAgentId, layout)
      .pipe(toAgentDuplicationFailed)
      .pipe(
        Effect.flatMap((result) =>
          duplicationStep(() => {
            this.#pendingAgents.delete(agentId);
            this.#pendingOperations.delete(agentId);
            this.#hooks.emit({ type: "agents-changed", agents: this.#hooks.listAgents() });
            if (this.#memories.listFor(result.agent.id).length > 0) this.#memories.stateChanged(result.agent.id);
            if (this.#routines.listFor(result.agent.id).length > 0) this.#routines.stateChanged(result.agent.id);
            this.#routines.arm();
            return result;
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            this.#pendingReleases.delete(agentId);
            releaseDuplication?.();
          }),
        ),
      );
  }, Effect.uninterruptible);

  releaseForDelete(agentId: string): { wasPending: boolean; release: () => void } {
    const wasPending = this.#pendingAgents.has(agentId);
    const release = this.#pendingReleases.get(agentId);
    return {
      wasPending,
      release: () => {
        if (!wasPending) return;
        this.#pendingReleases.delete(agentId);
        release?.();
      },
    };
  }

  forget(agentId: string): void {
    this.#pendingAgents.delete(agentId);
    this.#pendingOperations.delete(agentId);
  }

  assertAgentIdle(agentId: string): void {
    const queued = this.#mailbox.listQueue(agentId).deliveries.some((delivery) => delivery.status === "queued");
    if (queued) throw new Error(sourceText("error.agent.waitBeforeDuplicate"));
    this.#assertAgentQuiet(agentId);
  }

  #assertAgentQuiet(agentId: string): void {
    const inFlight = this.#mailbox
      .listQueue(agentId)
      .deliveries.some((delivery) => delivery.status === "starting" || delivery.status === "running");
    if (inFlight || this.#hooks.hasAttentionFor(agentId) || this.#conversation.snapshot(agentId)?.activeTurnId) {
      throw new Error(sourceText("error.agent.waitBeforeDuplicate"));
    }
  }

  readonly #acquireCommitLock = Effect.fn("DuplicationGate.acquireCommitLock")(function* (this: DuplicationGate) {
    const previous = this.#commitQueue;
    const current = Deferred.makeUnsafe<void>();
    this.#commitQueue = current;
    if (previous) yield* Deferred.await(previous);
    return () => {
      Deferred.doneUnsafe(current, Effect.void);
    };
  });

  #sourceSignature(agentId: string): string {
    return JSON.stringify({
      agent: duplicationProfileSignature(this.#conversation.requireKnownAgent(agentId)),
      memories: this.#memories.listFor(agentId),
      routines: this.#routines.listFor(agentId),
    });
  }

  #assertSourceUnchanged(agentId: string, signature: string): void {
    this.#assertAgentQuiet(agentId);
    if (this.#sourceSignature(agentId) !== signature) {
      throw new Error(sourceText("error.agent.changedWhileDuplicating"));
    }
  }
}

type DuplicatingAgents = Pick<
  AgentService,
  "duplicateAgent" | "commitAgentDuplication" | "deleteAgent" | "sidebarChatIds"
>;
type DuplicateSidebar = Pick<SidebarLayoutStore, "placeDuplicateAfter" | "removeAgent">;

export class AgentDuplicationFailed extends Schema.TaggedError<AgentDuplicationFailed>()("AgentDuplicationFailed", {
  cause: Schema.Defect(),
}) {}

const { sync: duplicationStep, rewrap: toAgentDuplicationFailed } = causeHelpers(AgentDuplicationFailed);

export { toAgentDuplicationFailed };

export const duplicateAgentIntoLayout = Effect.fn("Agent.duplicateIntoLayout")(function* (
  agents: DuplicatingAgents,
  sidebar: DuplicateSidebar,
  sourceAgentId: string,
  operationId?: string,
  beforeCommit?: (agentId: string) => Effect.Effect<void>,
) {
  const agent = yield* agents.duplicateAgent(sourceAgentId, operationId).pipe(toAgentDuplicationFailed);
  return yield* Effect.gen(function* () {
    if (beforeCommit) yield* beforeCommit(agent.id);
    const layout = yield* sidebar
      .placeDuplicateAfter(sourceAgentId, agent.id, [...agents.sidebarChatIds(), agent.id])
      .pipe(toAgentDuplicationFailed);
    return yield* agents.commitAgentDuplication(agent.id, layout).pipe(toAgentDuplicationFailed);
  }).pipe(
    Effect.catchDefect((cause) => Effect.fail(new AgentDuplicationFailed({ cause }))),
    Effect.catch((failure) =>
      Effect.gen(function* () {
        const rollbacks = yield* Effect.all(
          [
            Effect.result(
              agents.deleteAgent(agent.id).pipe(
                toAgentDuplicationFailed,
                Effect.catchDefect((cause) => Effect.fail(new AgentDuplicationFailed({ cause }))),
              ),
            ),
            Effect.result(
              sidebar.removeAgent(agent.id).pipe(
                toAgentDuplicationFailed,
                Effect.catchDefect((cause) => Effect.fail(new AgentDuplicationFailed({ cause }))),
                Effect.asVoid,
              ),
            ),
          ],
          { concurrency: "unbounded" },
        );
        const errors = rollbacks.flatMap((result) => (Result.isFailure(result) ? [result.failure.cause] : []));
        if (errors.length > 0) {
          return yield* new AgentDuplicationFailed({
            cause: new AggregateError([failure.cause, ...errors], sourceText("error.agent.duplicateCleanupFailed")),
          });
        }
        return yield* failure;
      }),
    ),
  );
}, Effect.uninterruptible);
