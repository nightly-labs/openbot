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
  StopRoutineFlowRunInput,
  UpdateRoutineFlowLinkInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { nextValidRoutineOccurrence, routineOnceInstant } from "@openbot/team-client/routine-schedule";
import { Context, Effect, Exit, Layer, ManagedRuntime, Schema, Scope, Semaphore } from "effect";
import { quietRoutineRun } from "../agent/routine-quiet-runs";
import { coalescedPasses } from "../coalesced-passes";
import { routineFlowDepths } from "./routine-flow-graph";
import { RoutineFlowError, type RoutineFlowRun, type RoutineFlowStore } from "./routine-flow-store";

const logger = createOpenBotLogger("routine-flows");

const SWEEP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const FULL_SWEEP_INTERVAL_MS = 30 * 60 * 1000;
const SWEEP_OVERLAP_MS = 10 * 60 * 1000;
const UPCOMING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const UPCOMING_LIMIT = 400;
const RECENT_RUNS = 10;

class RoutineFlowFailed extends Schema.TaggedError<RoutineFlowFailed>()("RoutineFlowFailed", {
  cause: Schema.Defect(),
}) {}

interface RoutineFlowDelivery {
  status: QueueDeliveryStatus;
  turnId: string | null;
  error: string | null;
}

export interface RoutineFlowsDependencies {
  store: RoutineFlowStore;
  routines: {
    list(agentId: string): RoutineFlowRoutineInfo[];
    get(agentId: string, routineId: string): RoutineFlowRoutineInfo | null;
    listRuns(agentId: string, routineId: string, limit?: number): RoutineRun[];
  };
  delivery(deliveryId: string): RoutineFlowDelivery | null;
  turnAnswer(agentId: string, turnId: string): string | null;
  agentName(agentId: string): string;
  sendHandoff(input: {
    run: Pick<RoutineFlowRun, "id" | "routineId" | "routineName" | "scheduledFor">;
    agentId: string;
    text: string;
    idempotencyKey: string;
  }): Effect.Effect<string, { readonly cause: unknown }>;
  stopRoutineRun(input: {
    agentId: string;
    routineId: string;
    runId: string;
  }): Effect.Effect<void, { readonly cause: unknown }>;
  stopDelivery(agentId: string, deliveryId: string): Effect.Effect<void, { readonly cause: unknown }>;
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
  agentsOf(
    ref: { routineId: string } | { linkId: string } | { runId: string },
  ): Effect.Effect<string[] | null, RoutineFlowFailed>;
  stopRun(input: StopRoutineFlowRunInput): Effect.Effect<void, RoutineFlowFailed>;
  sweep(): Effect.Effect<void>;
  notice(event: AgentEvent): Effect.Effect<void>;
}

export function routineFlowNoticeEvent(event: AgentEvent): boolean {
  return event.type === "turn-completed" || event.type === "queue-changed" || event.type === "routines-changed";
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
        let swept: SweepMark | null = null;

        const attempt = <A>(work: () => A) =>
          Effect.try({ try: work, catch: (cause) => new RoutineFlowFailed({ cause }) });

        const ownerOf = (routineId: string): RoutineFlowRoutineInfo | null => {
          const ownerAgentId = store.routineOwner(routineId);
          return ownerAgentId ? dependencies.routines.get(ownerAgentId, routineId) : null;
        };

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
          ref: { routineId: string } | { linkId: string } | { runId: string },
        ) {
          return yield* attempt(() => {
            if ("runId" in ref) {
              const run = store.run(ref.runId);
              if (!run || !store.routineOwner(run.routineId)) return null;
              return [
                ...new Set([...agentsOfRoutine(run.routineId), ...store.steps(run.id).map((step) => step.agentId)]),
              ];
            }
            const routineId = "routineId" in ref ? ref.routineId : store.link(ref.linkId)?.routineId;
            return routineId && store.routineOwner(routineId) ? agentsOfRoutine(routineId) : null;
          });
        });

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

        const settleFromDelivery = (step: RoutineFlowStep): boolean => {
          if (!step.deliveryId) return false;
          const delivery = dependencies.delivery(step.deliveryId);
          if (!delivery)
            return store.settleStep(step.id, "failed", null, sourceText("error.backend.routineFlowLinkGone"));
          if (delivery.status === "completed" && delivery.error !== null)
            return store.settleStep(step.id, "failed", null, delivery.error);
          if (delivery.status === "completed") {
            const output = delivery.turnId ? dependencies.turnAnswer(step.agentId, delivery.turnId) : null;
            return store.settleStep(step.id, "succeeded", output, null);
          }
          if (delivery.status === "cancelled") return store.settleStep(step.id, "cancelled", null, delivery.error);
          if (delivery.status === "failed" || delivery.status === "interrupted")
            return store.settleStep(step.id, "failed", null, delivery.error);
          return false;
        };

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
            if (sources.some(({ step }) => !step || step.status === "running")) continue;
            const answered = sources.filter(
              ({ step }) => step?.status === "succeeded" && !(step.output === null && quietRoutineRun(run)),
            );
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
          const at = now().getTime();
          const window = sweepWindow(swept, at);
          const since = new Date(window.since).toISOString();
          const changed = new Set<string>();
          const runIds = new Set<string>();
          for (const run of store.endedRunsWithoutOwnerStep(since)) {
            if (recordOwnerStep(run)) {
              changed.add(run.agentId);
              runIds.add(run.id);
            }
          }
          for (const step of store.runningSteps()) {
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
          for (const runId of store.runIdsWithPendingHandoff(since)) runIds.add(runId);
          for (const runId of runIds) {
            const run = store.run(runId);
            if (!run) continue;
            for (const agentId of yield* advance(run)) changed.add(agentId);
            if (changed.size > 0) for (const agentId of agentsOfRoutine(run.routineId)) changed.add(agentId);
          }
          swept = { at, fullAt: window.fullAt };
          if (changed.size > 0) dependencies.changed([...changed]);
        });

        const sweep = coalescedPasses(() =>
          lock.withPermit(sweepOnce()).pipe(
            Effect.catchCause((cause) =>
              Effect.sync(() => logger.warn("A routine flow sweep failed.", { cause: String(cause) })),
            ),
            Effect.withSpan("RoutineFlows.sweep"),
          ),
        );

        const notice = Effect.fn("RoutineFlows.notice")(function* (event: AgentEvent) {
          if (!routineFlowNoticeEvent(event)) return;
          yield* Effect.forkIn(sweep(), scope);
        });

        const stopRun = Effect.fn("RoutineFlows.stopRun")(function* (input: StopRoutineFlowRunInput) {
          const run = yield* attempt(() => {
            const found = store.run(input.runId);
            if (!found || found.routineId !== input.routineId)
              throw new RoutineFlowError(sourceText("error.backend.routineRunGone"));
            return found;
          });
          yield* dependencies
            .stopRoutineRun({ agentId: run.agentId, routineId: run.routineId, runId: run.id })
            .pipe(Effect.mapError((failure) => new RoutineFlowFailed({ cause: failure.cause })));
          const stopped = yield* lock.withPermit(
            attempt(() => {
              const steps = store.steps(run.id);
              const open = steps.filter((step) => step.status === "running");
              for (const step of open) store.settleStep(step.id, "cancelled", null, null);
              const links = store.linksForRoutines([run.routineId]).filter((link) => link.createdAt <= run.createdAt);
              const started = new Set(steps.map((step) => step.agentId));
              for (const agentId of routineFlowDepths(run.agentId, links).keys())
                if (agentId !== run.agentId && !started.has(agentId))
                  store.addStep({ runId: run.id, agentId, input: "", status: "skipped" });
              return open;
            }),
          );
          dependencies.changed(agentsOfRoutine(run.routineId));
          for (const step of stopped) {
            if (!step.deliveryId) continue;
            yield* dependencies.stopDelivery(step.agentId, step.deliveryId).pipe(
              Effect.catch((failure) =>
                Effect.sync(() =>
                  logger.warn("A stopped routine flow step did not stop.", {
                    stepId: step.id,
                    cause: String(failure.cause),
                  }),
                ),
              ),
            );
          }
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
          stopRun,
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

export const createRoutineFlows = Effect.fn("createRoutineFlows")(function* (dependencies: RoutineFlowsDependencies) {
  const runtime = ManagedRuntime.make(RoutineFlows.layer(dependencies));
  const context = yield* runtime.contextEffect.pipe(
    Effect.onExit((exit) => (Exit.isFailure(exit) ? runtime.disposeEffect : Effect.void)),
  );
  const service = Context.get(context, RoutineFlows);
  return { ...service, close: () => runtime.disposeEffect } satisfies RoutineFlowsHandle;
});

interface SweepMark {
  at: number;
  fullAt: number;
}

function sweepWindow(swept: SweepMark | null, at: number): { since: number; fullAt: number } {
  if (swept === null || at < swept.at || at - swept.fullAt >= FULL_SWEEP_INTERVAL_MS)
    return { since: at - SWEEP_WINDOW_MS, fullAt: at };
  return { since: swept.at - SWEEP_OVERLAP_MS, fullAt: swept.fullAt };
}

function handoffText(
  routineName: string,
  inputs: readonly { from: string; answer: string; instruction: string }[],
): string {
  const parts = inputs.map((input) => `${input.from} answered:\n\n${input.answer || "(no answer text)"}`);
  const instructions = [...new Set(inputs.map((input) => input.instruction.trim()).filter(Boolean))];
  const task = instructions.length > 0 ? instructions.join("\n\n") : "Do your part of the routine with this.";
  return `The routine "${routineName}" continues with you.\n\n${parts.join("\n\n---\n\n")}\n\n${task}`;
}

function upcoming(routine: RoutineFlowRoutineInfo, from: Date): string[] {
  if (routine.trigger.kind !== "schedule") return [];
  const schedule = routine.trigger.schedule;
  const end = from.getTime() + UPCOMING_WINDOW_MS;
  if (schedule.kind === "once") {
    const at = routineOnceInstant(schedule, routine.timezone).getTime();
    return at > from.getTime() && at < end ? [new Date(at).toISOString()] : [];
  }
  const times: string[] = [];
  try {
    for (
      let next = nextValidRoutineOccurrence(schedule, routine.timezone, from);
      next.getTime() < end && times.length < UPCOMING_LIMIT;
      next = nextValidRoutineOccurrence(schedule, routine.timezone, new Date(next.getTime() + 1))
    )
      times.push(next.toISOString());
  } catch (error) {
    logger.warn("A routine schedule did not expand.", { routineId: routine.id, error: String(error) });
  }
  return times;
}
