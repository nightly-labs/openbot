import { randomUUID } from "node:crypto";
import type { AgentEvent, AgentSummary, SidebarLayoutSnapshot } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Result, Schema } from "effect";
import type { AgentService } from "../agent-service";
import { type AgentStore, duplicationProfileSignature } from "../agent-store";
import type { MailboxStore } from "../mailbox-store";
import type { SidebarLayoutStore } from "../sidebar-layout-store";
import type { AgentMemories } from "./agent-memories";
import type { ConversationRuntime } from "./conversation-runtime";
import type { RoutineScheduler } from "./routine-scheduler";

export interface DuplicationHooks {
  emit(event: AgentEvent): void;
  listAgents(): AgentSummary[];
  /** Removes a half-written copy: its workspace, mailbox rows and provider sessions. */
  deleteAgentData(agent: AgentSummary): Effect.Effect<void, AgentDuplicationFailed>;
  /** A agent with an outstanding question is not idle, even with an empty queue. */
  hasAttentionFor(agentId: string): boolean;
  /** Re-arms a queue this gate held, so a message that waited out a copy is not stranded. */
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

/**
 * Copying an agent, and the window between the copy existing and the user accepting it.
 *
 * A duplicate is created in the database before the user has confirmed where it goes, so for that
 * window it is a real row that must not behave like a real agent: it is hidden from `listAgents`, it
 * never drains its queue, its routines never fire, and `Unknown agent` is the honest answer for it.
 * Every path out of that window — commit, delete, or a failed copy — has to clear the same four
 * maps, which is why they live in one class rather than beside the code that happens to set them.
 *
 * The copy itself is guarded twice over. `#duplicatingAgents` refuses a second concurrent copy of one
 * source; `#commitQueue` serialises commits so two duplications cannot interleave their store
 * writes; and the source signature is re-compared after every step, so an agent edited mid-copy
 * aborts rather than producing a duplicate that matches neither state.
 */
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

  /**
   * The duplication clause in the drain mute registry. A pending copy never drains at all, and a
   * source holds its queue for the length of the copy.
   *
   * `assertAgentIdle` already refuses to start duplicating a busy agent, but it only looks once, and
   * copying a large workspace runs for seconds afterwards. Without this clause a message arriving
   * inside that window starts a turn that writes into the tree being copied, and the workspace
   * fingerprint then rejects the copy — correctly, but the user loses it. Holding the queue answers
   * the same message a few seconds later and keeps the copy.
   */
  mayDrain(agentId: string): boolean {
    return !this.#pendingAgents.has(agentId) && !this.#duplicatingAgents.has(agentId);
  }

  /** A pending duplicate is not yet an agent: it is hidden, and unknown to anything that looks up. */
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
      duplicate = yield* this.#store
        .duplicateAgent(sourceAgentId, operationId)
        .pipe(Effect.mapError((failure) => new AgentDuplicationFailed({ cause: failure.cause })));
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
          completedDuplicate = this.#store.setMarketplaceSource(copied.id, {
            ...structuredClone(source.marketplaceSource),
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
              Effect.mapError((failure) => new AgentDuplicationFailed({ cause: failure.cause })),
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
      .pipe(Effect.mapError((failure) => new AgentDuplicationFailed({ cause: failure.cause })))
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

  /**
   * Hands an agent deletion the commit-lock release it must run, so deleting a duplicate the user
   * rejected does not leave the next duplication waiting on a lock nobody holds. Returns whether
   * the agent was pending, which is what decides if `agents-changed` still needs emitting.
   */
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

  /** The precondition for starting a copy: nothing is waiting, and nothing is in flight. */
  assertAgentIdle(agentId: string): void {
    const queued = this.#mailbox.listQueue(agentId).deliveries.some((delivery) => delivery.status === "queued");
    if (queued) throw new Error(sourceText("error.agent.waitBeforeDuplicate"));
    this.#assertAgentQuiet(agentId);
  }

  /**
   * Nothing the copy could race is in flight.
   *
   * A message that arrived *after* the copy started is held queued by `mayDrain` and has changed
   * nothing a duplicate takes — the copy carries no conversation, and an unstarted delivery has not
   * touched the workspace. So it is deliberately not counted here: counting it would let any
   * incoming message destroy a copy that is seconds from finishing.
   */
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

  /**
   * Signs the same profile the store signs, so the two layers cannot disagree about what "changed"
   * means — otherwise narrowing one of them just moves the identical error message one frame out.
   */
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

/**
 * Copies an agent and places the copy after its source in the sidebar. This is a two-store transaction:
 * if placing or committing fails, the half-made copy has to go, or the user keeps an agent they never
 * asked for.
 */
export class AgentDuplicationFailed extends Schema.TaggedError<AgentDuplicationFailed>()("AgentDuplicationFailed", {
  cause: Schema.Defect(),
}) {}

/** A cancelled caller must not leave an uncommitted copy or interrupt its rollback. */
export const duplicateAgentIntoLayout = Effect.fn("Agent.duplicateIntoLayout")(function* (
  agents: DuplicatingAgents,
  sidebar: DuplicateSidebar,
  sourceAgentId: string,
  operationId?: string,
) {
  const agent = yield* agents
    .duplicateAgent(sourceAgentId, operationId)
    .pipe(Effect.mapError((failure) => new AgentDuplicationFailed({ cause: failure.cause })));
  return yield* Effect.gen(function* () {
    const layout = yield* sidebar
      .placeDuplicateAfter(sourceAgentId, agent.id, [...agents.sidebarChatIds(), agent.id])
      .pipe(Effect.mapError((failure) => new AgentDuplicationFailed({ cause: failure.cause })));
    return yield* agents
      .commitAgentDuplication(agent.id, layout)
      .pipe(Effect.mapError((failure) => new AgentDuplicationFailed({ cause: failure.cause })));
  }).pipe(
    Effect.catchDefect((cause) => Effect.fail(new AgentDuplicationFailed({ cause }))),
    Effect.catch((failure) =>
      Effect.gen(function* () {
        const rollbacks = yield* Effect.all(
          [
            Effect.result(
              agents.deleteAgent(agent.id).pipe(
                Effect.mapError((failure) => new AgentDuplicationFailed({ cause: failure.cause })),
                Effect.catchDefect((cause) => Effect.fail(new AgentDuplicationFailed({ cause }))),
              ),
            ),
            Effect.result(
              sidebar.removeAgent(agent.id).pipe(
                Effect.mapError((failure) => new AgentDuplicationFailed({ cause: failure.cause })),
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

function duplicationStep<A>(operation: () => A): Effect.Effect<A, AgentDuplicationFailed> {
  return Effect.try({ try: operation, catch: (cause) => new AgentDuplicationFailed({ cause }) });
}
