/**
 * Routine flows: an agent routine's answer handed on from agent to agent.
 *
 * The routine's own agent runs as it always has. When its run ends, its answer becomes the flow's
 * first step. Each link of the routine then sends that answer on to the next agent as a message
 * from the routine; an agent with several inputs waits until all of them are in and gets them in
 * one message. Its answer, once in, goes on the same way. An agent whose every input failed or was
 * skipped is skipped too, so a failure never leaves a flow waiting.
 *
 * Nothing here listens to the provider. The runtime looks at a run's own delivery and at the
 * deliveries it sent, whenever the agent service says a turn, a queue or a routine changed, and at
 * startup. That one sweep also covers the ends that raise no turn event: a delivery that failed to
 * start, and one a restart interrupted. Sweeps run one at a time; a request during a sweep runs one
 * more after it.
 *
 * A link only applies to the runs a routine starts after it was made, so connecting an agent never
 * sends it the answer of an earlier run.
 */

import type {
  AgentEvent,
  ConnectRoutineFlowInput,
  DisconnectRoutineFlowInput,
  QueueDeliveryStatus,
  RemoveRoutineFlowPositionInput,
  RoutineFlowCanvas,
  RoutineFlowLink,
  RoutineFlowRoutine,
  RoutineFlowRoutineInfo,
  RoutineFlowStep,
  RoutineRun,
  SaveRoutineFlowPositionInput,
  UpdateRoutineFlowLinkInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { nextValidRoutineOccurrence } from "@openbot/team-client/routine-schedule";
import { Context, Effect, Exit, Layer, ManagedRuntime, Schema, Scope, Semaphore } from "effect";
import { routineFlowDepths } from "./routine-flow-graph";
import { RoutineFlowError, type RoutineFlowRun, type RoutineFlowStore } from "./routine-flow-store";

const logger = createOpenBotLogger("routine-flows");

/** How far back a sweep looks for a run whose flow may still move. */
const SWEEP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const UPCOMING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** A routine every three minutes fires a few thousand times a week; the canvas needs far fewer. */
const UPCOMING_LIMIT = 400;
const RECENT_RUNS = 10;

class RoutineFlowFailed extends Schema.TaggedError<RoutineFlowFailed>()("RoutineFlowFailed", {
  cause: Schema.Defect(),
}) {}

/** A delivery as the runtime reads it: whether it ended, and the turn that answered it. */
export interface RoutineFlowDelivery {
  status: QueueDeliveryStatus;
  turnId: string | null;
  error: string | null;
}

export interface RoutineFlowsDependencies {
  store: RoutineFlowStore;
  routines: {
    /** Routines of every trigger kind: a schedule or a webhook starts each one. */
    list(agentId: string): RoutineFlowRoutineInfo[];
    get(agentId: string, routineId: string): RoutineFlowRoutineInfo | null;
    listRuns(agentId: string, routineId: string, limit?: number): RoutineRun[];
  };
  delivery(deliveryId: string): RoutineFlowDelivery | null;
  /** The answer an agent gave in one turn, or null when it gave none. */
  turnAnswer(agentId: string, turnId: string): string | null;
  agentName(agentId: string): string;
  sendHandoff(input: {
    run: Pick<RoutineFlowRun, "id" | "routineId" | "routineName" | "scheduledFor">;
    agentId: string;
    text: string;
    idempotencyKey: string;
  }): Effect.Effect<string, { readonly cause: unknown }>;
  /** The agents whose canvases changed. */
  changed(agentIds: string[]): void;
  now?: () => Date;
}

export interface RoutineFlowsShape {
  canvas(agentId: string): Effect.Effect<RoutineFlowCanvas, RoutineFlowFailed>;
  savePosition(input: SaveRoutineFlowPositionInput): Effect.Effect<void, RoutineFlowFailed>;
  removePosition(input: RemoveRoutineFlowPositionInput): Effect.Effect<void, RoutineFlowFailed>;
  connect(input: ConnectRoutineFlowInput): Effect.Effect<RoutineFlowLink, RoutineFlowFailed>;
  disconnect(input: DisconnectRoutineFlowInput): Effect.Effect<void, RoutineFlowFailed>;
  updateLink(input: UpdateRoutineFlowLinkInput): Effect.Effect<RoutineFlowLink, RoutineFlowFailed>;
  /**
   * Every agent a routine touches, or the routine of a link touches: its own agent and both agents of
   * each of its links. Null when the routine or link does not exist. A joined member may change a
   * flow only when all of them are visible to the member.
   */
  agentsOf(ref: { routineId: string } | { linkId: string }): Effect.Effect<string[] | null, RoutineFlowFailed>;
  /** Moves every flow that can move now. */
  sweep(): Effect.Effect<void>;
  /** Asks for a sweep when an agent event may have ended a step. Returns at once. */
  notice(event: AgentEvent): Effect.Effect<void>;
}

class RoutineFlows extends Context.Service<RoutineFlows, RoutineFlowsShape>()("openbot/backend/RoutineFlows") {
  static layer(dependencies: RoutineFlowsDependencies) {
    return Layer.effect(
      RoutineFlows,
      Effect.gen(function* () {
        const scope = yield* Scope.Scope;
        const lock = yield* Semaphore.make(1);
        const { store } = dependencies;
        const now = () => (dependencies.now ?? (() => new Date()))();
        /** A sweep running, and whether another was asked for while it ran. */
        let sweeping = false;
        let again = false;

        const attempt = <A>(work: () => A) =>
          Effect.try({ try: work, catch: (cause) => new RoutineFlowFailed({ cause }) });

        const ownerOf = (routineId: string): RoutineFlowRoutineInfo | null => {
          const ownerAgentId = store.routineOwner(routineId);
          return ownerAgentId ? dependencies.routines.get(ownerAgentId, routineId) : null;
        };

        /** Everyone whose canvas shows this routine: its agent and every agent its links name. */
        const agentsOfRoutine = (routineId: string): string[] => {
          const ownerAgentId = store.routineOwner(routineId);
          const links = store.linksForRoutines([routineId]);
          return [
            ...new Set([
              ...(ownerAgentId ? [ownerAgentId] : []),
              ...links.flatMap((link) => [link.fromAgentId, link.toAgentId]),
            ]),
          ];
        };

        const flowRoutine = (routine: RoutineFlowRoutineInfo): RoutineFlowRoutine => {
          const recentRuns = dependencies.routines.listRuns(routine.agentId, routine.id, RECENT_RUNS);
          const newest = recentRuns[0];
          return {
            routine,
            recentRuns,
            upcomingRuns: routine.active ? upcoming(routine, now()) : [],
            steps: newest ? store.steps(newest.id) : [],
          };
        };

        const canvas = Effect.fn("RoutineFlows.canvas")(function* (agentId: string) {
          return yield* attempt((): RoutineFlowCanvas => {
            const own = dependencies.routines.list(agentId);
            const ownIds = new Set(own.map((routine) => routine.id));
            const others = store
              .routineIdsTouching(agentId)
              .filter((routineId) => !ownIds.has(routineId))
              .map(ownerOf)
              .filter((routine): routine is RoutineFlowRoutineInfo => routine !== null);
            const routines = [...own, ...others];
            const positions = store.positions(agentId);
            return {
              agentId,
              routines: routines.map(flowRoutine),
              links: store.linksForRoutines(routines.map((routine) => routine.id)),
              positions,
              placedAgentIds: positions.flatMap((position) =>
                position.nodeKey.startsWith("agent:") ? [position.nodeKey.slice("agent:".length)] : [],
              ),
            };
          });
        });

        const savePosition = Effect.fn("RoutineFlows.savePosition")(function* (input: SaveRoutineFlowPositionInput) {
          yield* attempt(() => store.savePosition(input.agentId, input.nodeKey, input.x, input.y));
          // Another client with this canvas open shows a placed or moved agent without a reload.
          dependencies.changed([input.agentId]);
        });

        const removePosition = Effect.fn("RoutineFlows.removePosition")(function* (
          input: RemoveRoutineFlowPositionInput,
        ) {
          yield* attempt(() => store.removePosition(input.agentId, input.nodeKey));
          dependencies.changed([input.agentId]);
        });

        const connect = Effect.fn("RoutineFlows.connect")(function* (input: ConnectRoutineFlowInput) {
          const link = yield* attempt(() => {
            const routine = ownerOf(input.routineId);
            if (!routine) throw new RoutineFlowError(sourceText("error.backend.routineGone"));
            return store.createLink(routine.agentId, input, now().toISOString());
          });
          dependencies.changed(agentsOfRoutine(link.routineId));
          return link;
        });

        const updateLink = Effect.fn("RoutineFlows.updateLink")(function* (input: UpdateRoutineFlowLinkInput) {
          const link = yield* attempt(() => store.updateLinkInstruction(input.linkId, input.instruction));
          dependencies.changed(agentsOfRoutine(link.routineId));
          return link;
        });

        const disconnect = Effect.fn("RoutineFlows.disconnect")(function* (input: DisconnectRoutineFlowInput) {
          const removed = yield* attempt(() => {
            const before = store.link(input.linkId);
            const affected = before ? agentsOfRoutine(before.routineId) : [];
            const gone = store.deleteLink(input.linkId, (routineId) => store.routineOwner(routineId));
            return { gone, affected };
          });
          dependencies.changed(removed.affected);
        });

        const agentsOf = Effect.fn("RoutineFlows.agentsOf")(function* (
          ref: { routineId: string } | { linkId: string },
        ) {
          return yield* attempt(() => {
            const routineId = "routineId" in ref ? ref.routineId : store.link(ref.linkId)?.routineId;
            return routineId && store.routineOwner(routineId) ? agentsOfRoutine(routineId) : null;
          });
        });

        /** The routine's own agent's part of a run that ended: its answer, or why there is none. */
        const recordOwnerStep = (run: RoutineFlowRun): boolean => {
          const delivery = run.deliveryId ? dependencies.delivery(run.deliveryId) : null;
          if (run.status === "succeeded") {
            const output = delivery?.turnId ? dependencies.turnAnswer(run.agentId, delivery.turnId) : null;
            return (
              store.addStep({
                runId: run.id,
                agentId: run.agentId,
                input: run.instruction,
                status: "succeeded",
                output,
              }) !== null
            );
          }
          const status = run.status === "cancelled" ? "cancelled" : "failed";
          return (
            store.addStep({
              runId: run.id,
              agentId: run.agentId,
              input: run.instruction,
              status,
              error: run.error ?? delivery?.error ?? null,
            }) !== null
          );
        };

        /** Ends a step whose delivery ended. Answers whether it changed. */
        const settleFromDelivery = (step: RoutineFlowStep): boolean => {
          if (!step.deliveryId) return false;
          const delivery = dependencies.delivery(step.deliveryId);
          if (!delivery)
            return store.settleStep(step.id, "failed", null, sourceText("error.backend.routineFlowLinkGone"));
          if (delivery.status === "completed") {
            const output = delivery.turnId ? dependencies.turnAnswer(step.agentId, delivery.turnId) : null;
            return store.settleStep(step.id, "succeeded", output, null);
          }
          if (delivery.status === "cancelled") return store.settleStep(step.id, "cancelled", null, delivery.error);
          if (delivery.status === "failed" || delivery.status === "interrupted")
            return store.settleStep(step.id, "failed", null, delivery.error);
          return false;
        };

        /**
         * Sends one step's input to its agent and keeps the delivery. The key is the step's, so a
         * second attempt after a restart finds the delivery the first one made instead of sending
         * twice. A handoff that cannot go out fails the step, and the agents after it are skipped.
         */
        const sendStep = Effect.fn("RoutineFlows.sendStep")(function* (run: RoutineFlowRun, step: RoutineFlowStep) {
          const sent = yield* dependencies
            .sendHandoff({ run, agentId: step.agentId, text: step.input, idempotencyKey: `routine-flow-${step.id}` })
            .pipe(Effect.exit);
          if (Exit.isSuccess(sent)) {
            store.attachDelivery(step.id, sent.value);
            return;
          }
          const cause = Exit.isFailure(sent) ? sent.cause : null;
          logger.warn("A routine flow could not hand work on.", {
            runId: run.id,
            agentId: step.agentId,
            cause: String(cause),
          });
          store.settleStep(step.id, "failed", null, sourceText("error.backend.routineFlowHandoffFailed"));
        });

        /**
         * Sends a run's answers on as far as they can go now. Answers the agents it gave a step, so
         * the views showing them reload.
         */
        const advance = Effect.fn("RoutineFlows.advance")(function* (run: RoutineFlowRun) {
          const changed = new Set<string>();
          const links = store.linksForRoutines([run.routineId]).filter((link) => link.createdAt <= run.createdAt);
          if (links.length === 0) return changed;
          const depths = routineFlowDepths(run.agentId, links);
          const steps = new Map(store.steps(run.id).map((step) => [step.agentId, step]));
          const order = [...depths.entries()]
            .filter(([agentId]) => agentId !== run.agentId)
            .sort((left, right) => left[1] - right[1])
            .map(([agentId]) => agentId);
          for (const agentId of order) {
            if (steps.has(agentId)) continue;
            const incoming = links.filter((link) => link.toAgentId === agentId && depths.has(link.fromAgentId));
            const sources = incoming.map((link) => ({ link, step: steps.get(link.fromAgentId) }));
            // Waits for every input: one that has not ended yet holds the agent back.
            if (sources.some(({ step }) => !step || step.status === "running")) continue;
            const answered = sources.filter(({ step }) => step?.status === "succeeded");
            if (answered.length === 0) {
              const skipped = store.addStep({ runId: run.id, agentId, input: "", status: "skipped" });
              if (skipped) {
                steps.set(agentId, skipped);
                changed.add(agentId);
              }
              continue;
            }
            const text = handoffText(
              run.routineName,
              answered.map(({ link, step }) => ({
                from: dependencies.agentName(link.fromAgentId),
                answer: step?.output ?? "",
                instruction: link.instruction,
              })),
            );
            const step = store.addStep({ runId: run.id, agentId, input: text, status: "running" });
            if (!step) continue;
            steps.set(agentId, step);
            changed.add(agentId);
            yield* sendStep(run, step);
            const current = store.steps(run.id).find((candidate) => candidate.id === step.id);
            if (current) steps.set(agentId, current);
          }
          return changed;
        });

        const sweepOnce = Effect.fn("RoutineFlows.sweepOnce")(function* () {
          const since = new Date(now().getTime() - SWEEP_WINDOW_MS).toISOString();
          const changed = new Set<string>();
          const runIds = new Set<string>();
          for (const run of store.endedRunsWithoutOwnerStep(since)) {
            if (recordOwnerStep(run)) {
              changed.add(run.agentId);
              runIds.add(run.id);
            }
          }
          for (const step of store.runningSteps()) {
            // A step without a delivery lost its handoff to a restart between the two writes.
            if (!step.deliveryId) {
              const run = store.run(step.runId);
              if (!run) continue;
              yield* sendStep(run, step);
              changed.add(step.agentId);
              runIds.add(step.runId);
              continue;
            }
            if (settleFromDelivery(step)) {
              changed.add(step.agentId);
              runIds.add(step.runId);
            }
          }
          // Also every run with a recent step: a restart between an answer and its handoff resumes here.
          for (const runId of store.runIdsWithStepsSince(since)) runIds.add(runId);
          for (const runId of runIds) {
            const run = store.run(runId);
            if (!run) continue;
            for (const agentId of yield* advance(run)) changed.add(agentId);
            if (changed.size > 0) for (const agentId of agentsOfRoutine(run.routineId)) changed.add(agentId);
          }
          if (changed.size > 0) dependencies.changed([...changed]);
        });

        const sweep = Effect.fn("RoutineFlows.sweep")(function* () {
          if (sweeping) {
            again = true;
            return;
          }
          sweeping = true;
          try {
            do {
              again = false;
              yield* lock
                .withPermit(sweepOnce())
                .pipe(
                  Effect.catchCause((cause) =>
                    Effect.sync(() => logger.warn("A routine flow sweep failed.", { cause: String(cause) })),
                  ),
                );
            } while (again);
          } finally {
            sweeping = false;
          }
        });

        const notice = Effect.fn("RoutineFlows.notice")(function* (event: AgentEvent) {
          if (event.type !== "turn-completed" && event.type !== "queue-changed" && event.type !== "routines-changed")
            return;
          yield* Effect.forkIn(sweep(), scope);
        });

        return RoutineFlows.of({
          canvas,
          savePosition,
          removePosition,
          connect,
          disconnect,
          updateLink,
          agentsOf,
          sweep,
          notice,
        });
      }),
    );
  }
}

export interface RoutineFlowsHandle extends RoutineFlowsShape {
  close(): Effect.Effect<void>;
}

/** Starts the service on its own runtime; `close` stops the sweeps it forked. */
export const createRoutineFlows = Effect.fn("createRoutineFlows")(function* (dependencies: RoutineFlowsDependencies) {
  const runtime = ManagedRuntime.make(RoutineFlows.layer(dependencies));
  const context = yield* runtime.contextEffect.pipe(
    Effect.onExit((exit) => (Exit.isFailure(exit) ? runtime.disposeEffect : Effect.void)),
  );
  const service = Context.get(context, RoutineFlows);
  return { ...service, close: () => runtime.disposeEffect } satisfies RoutineFlowsHandle;
});

/** The message an agent gets from the agents before it. The text goes to a provider, so it stays English. */
function handoffText(
  routineName: string,
  inputs: readonly { from: string; answer: string; instruction: string }[],
): string {
  const parts = inputs.map((input) => `${input.from} answered:\n\n${input.answer || "(no answer text)"}`);
  const instructions = [...new Set(inputs.map((input) => input.instruction.trim()).filter(Boolean))];
  const task = instructions.length > 0 ? instructions.join("\n\n") : "Do your part of the routine with this.";
  return `The routine "${routineName}" continues with you.\n\n${parts.join("\n\n---\n\n")}\n\n${task}`;
}

/** The times a routine fires in the next week, soonest first, from its schedule. A webhook has none. */
function upcoming(routine: RoutineFlowRoutineInfo, from: Date): string[] {
  if (routine.trigger.kind !== "schedule") return [];
  const schedule = routine.trigger.schedule;
  const end = from.getTime() + UPCOMING_WINDOW_MS;
  const times: string[] = [];
  try {
    for (
      let next = nextValidRoutineOccurrence(schedule, routine.timezone, from);
      next.getTime() < end && times.length < UPCOMING_LIMIT;
      // One millisecond on, so an occurrence never answers itself.
      next = nextValidRoutineOccurrence(schedule, routine.timezone, new Date(next.getTime() + 1))
    )
      times.push(next.toISOString());
  } catch (error) {
    // A schedule the store accepted always expands; if one does not, the canvas shows no times.
    logger.warn("A routine schedule did not expand.", { routineId: routine.id, error: String(error) });
  }
  return times;
}
