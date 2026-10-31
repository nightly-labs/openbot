/**
 * Workflows: graphs of steps that a person draws on a canvas, their versions, and their runs.
 *
 * The store keeps the rows and checks the graph rules. This service is the one way in for main and
 * the Team API, and it says which workflow changed, so every view that shows it reads it again.
 *
 * A run copies the graph it starts from. Each pass reads the run's steps, ends what ended, and
 * starts each node whose inputs are in (see `workflow-walk.ts`). An agent step is a message from the
 * workflow to the agent, sent as a routine handoff; it ends when its delivery ends. A model step and
 * a condition run here, one at a time, without tools. Nothing listens to the provider: a pass runs
 * whenever the agent service says a turn or a queue changed, after each user action, and at
 * startup. Passes run one at a time; a request during a pass runs one more after it.
 *
 * An output to a messaging place posts in a fiber of its own, too. Its post is kept before it is
 * sent and marked on its way before the post starts, as a routine result is. A post that fails is
 * not sent again by itself: a long text goes in more than one post, so part of it can be in the
 * place. The user retries the step.
 *
 * A GitHub event starts the run of each GitHub trigger that watches it (`github-matching.ts`). A
 * GitHub run blocks only its own item: an event of an item whose run is open waits in the trigger's
 * history and starts when that run ends, and runs of other items run at the same time. Schedules and
 * webhooks keep one open run per workflow. An event that a step of the same workflow caused, or the
 * next of a long chain of runs that OpenBot's bot caused on one item, starts nothing.
 *
 * A restart keeps approvals and agent steps: their state is in the database and in the mailbox. A
 * model step lives in this process only, so the first pass after a restart fails it. A post that
 * did not start is sent then; one that was on its way fails as uncertain.
 */

import { isAgentProvider } from "@openbot/contracts/agent-providers";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AgentEvent,
  type AgentReasoningEffort,
  type CreateWorkflowInput,
  type DecideWorkflowStepInput,
  graphAgentIds,
  isReasoningEffort,
  nodeAgentId,
  type QueueDeliveryStatus,
  type RenameWorkflowInput,
  type RetryWorkflowStepInput,
  type RunWorkflowStepInput,
  type SaveWorkflowGraphInput,
  type StartWorkflowRunInput,
  WORKFLOW_GITHUB_EVENTS,
  type WorkflowDetail,
  type WorkflowGitHubHistory,
  type WorkflowGitHubLastEventInput,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNodeKind,
  type WorkflowRun,
  type WorkflowRunDetail,
  type WorkflowRunPage,
  type WorkflowRunSource,
  type WorkflowRunsInput,
  type WorkflowSaveResult,
  type WorkflowStep,
  type WorkflowSummary,
  type WorkflowVersion,
  type WorkflowVersionInput,
} from "@openbot/contracts/ipc";
import { isOneOf } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Cause, Context, Effect, Exit, Fiber, Layer, ManagedRuntime, Result, Schema, Scope, Semaphore } from "effect";
import { isNoUpdateAnswer } from "../agent/routine-quiet-runs";
import type { AgentProvider } from "../agent-client";
import { coalescedPasses } from "../coalesced-passes";
import type { MessagingPostFailure } from "../messaging/messaging-threads";
import { resultText } from "../routine-results/routine-results";
import type { ReceivedWebhookEvent } from "../routine-store";
import {
  githubEventFacts,
  githubFilterRefuses,
  githubTriggerMatches,
  githubTriggerRepository,
  workflowGitHubPayload,
} from "./github-matching";
import {
  type GitHubOutputPlan,
  githubChangeKeys,
  githubChoicePrompt,
  githubChoices,
  githubOutputPlan,
  githubOutputText,
  githubResultKeys,
} from "./github-output";
import { REPEATABLE_GITHUB_ACTIONS, type WorkflowGitHubApi } from "./workflow-github-api";
import type { WaitingGitHubDelivery, WorkflowGitHubStore } from "./workflow-github-store";
import {
  isOpenStep,
  publicRun,
  publicStep,
  type StoredWorkflowRun,
  type StoredWorkflowStep,
  type WorkflowOutputDelivery,
  type WorkflowRunStore,
  type WorkflowStepEnd,
} from "./workflow-run-store";
import { type WorkflowStore, WorkflowStoreError } from "./workflow-store";
import { prepareWorkflowSchedules, type ScheduledWorkflowStart, workflowWebhookPayload } from "./workflow-triggers";
import {
  agentStepText,
  conditionAnswer,
  conditionPrompt,
  fieldText,
  inputText,
  modelStepPrompt,
  nextActions,
  runScope,
  soloInputs,
  unsupportedNode,
} from "./workflow-walk";

const logger = createOpenBotLogger("workflows");

/** A chain of runs that OpenBot's bot caused on one item stops after this many in the window. */
const GITHUB_CHAIN_RUNS = 3;
const GITHUB_CHAIN_WINDOW_MS = 10 * 60_000;
/** How long a change that a GitHub output made is known as this workflow's own. */
const GITHUB_SELF_WINDOW_MS = 60 * 60_000;

class WorkflowFailed extends Schema.TaggedError<WorkflowFailed>()("WorkflowFailed", {
  cause: Schema.Defect(),
}) {}

/** A delivery as the runtime reads it: whether it ended, and the turn that answered it. */
interface WorkflowDelivery {
  status: QueueDeliveryStatus;
  turnId: string | null;
  error: string | null;
}

/** What a person must see outside the canvas: a step that waits for them, or an output. */
export interface WorkflowNotice {
  kind: "approval" | "output";
  workflowId: string;
  workflowTitle: string;
  text: string;
}

interface WorkflowTextRequest {
  provider: AgentProvider | null;
  model: string | null;
  effort: AgentReasoningEffort | null;
  prompt: string;
}

/** How a run began, and the key that makes a second start of the same run answer the first. */
interface RunOrigin {
  source: WorkflowRunSource;
  scheduledFor: string | null;
  idempotencyKey: string;
  payload: string | null;
}

/** How a run ended, for the host's product analytics: no title, text or ID of the user. */
export interface WorkflowRunEnd {
  runId: string;
  status: "done" | "failed" | "stopped";
  source: WorkflowRunSource;
  startedAt: string;
  endedAt: string;
  /** The kind of each node that ran, by its newest attempt. Skipped nodes are not in it. */
  stepKinds: WorkflowNodeKind[];
}

export interface WorkflowsDependencies {
  store: WorkflowStore;
  runs: WorkflowRunStore;
  delivery(deliveryId: string): WorkflowDelivery | null;
  /** The answer an agent gave in one turn, or null when it gave none. */
  turnAnswer(agentId: string, turnId: string): string | null;
  sendHandoff(input: {
    run: { id: string; routineId: string; routineName: string; scheduledFor: string };
    agentId: string;
    text: string;
    idempotencyKey: string;
  }): Effect.Effect<string, { readonly cause: unknown }>;
  /** Ends a delivery: cancels it while it waits, or interrupts the turn that answers it. */
  stopDelivery(agentId: string, deliveryId: string): Effect.Effect<void, { readonly cause: unknown }>;
  /** One tool-less generation; the failure is a message the user can read. */
  generateText(request: WorkflowTextRequest): Effect.Effect<string, { readonly message: string }>;
  notify(notice: WorkflowNotice): void;
  /** Whether a messaging connection of this host is on. */
  connectionOn(connectionId: string): boolean;
  /** Posts Markdown to a place of a messaging connection, in more than one post when it is long. */
  post(
    connectionId: string,
    placeId: string,
    markdown: string,
  ): Effect.Effect<{ posted: true } | { failure: MessagingPostFailure }>;
  /** The workflow whose graph, title, versions or runs changed. */
  changed(workflowId: string): void;
  /**
   * Plans the schedule timer again: a trigger changed, or a run ended, and an occurrence that waited
   * for it is due.
   */
  rearm(): void;
  /** The zone of a schedule trigger that names none: the server timezone. */
  timezone(): string;
  /** A run ended. */
  runEnded?: (end: WorkflowRunEnd) => void;
  /** The GitHub tables; see `workflow-github-store.ts`. */
  github: WorkflowGitHubStore;
  /** The slug of the OpenBot GitHub App, whose bot makes the changes of GitHub outputs. */
  githubApp(): string | null;
  /** The repositories that the saved GitHub triggers watch, after each change of them. */
  watchGitHub?: (repositories: string[]) => void;
  /** GitHub as OpenBot's bot; absent where this host has no GitHub connection to give. */
  githubApi?: WorkflowGitHubApi;
  now?: () => Date;
}

/** One verified request to a webhook trigger of a workflow. */
export interface WorkflowWebhookDelivery {
  workflowId: string;
  nodeId: string;
  event: ReceivedWebhookEvent;
}

/**
 * What a webhook trigger did with a request. A busy workflow skips it, as a schedule does; a graph
 * that cannot start, such as one with a node of a newer version, refuses it.
 */
export type WorkflowWebhookResult =
  | { kind: "started"; run: WorkflowRun }
  | { kind: "ignored"; reason: "busy" | "refused" }
  | { kind: "duplicate" }
  | { kind: "gone" }
  | { kind: "too-large" };

/** One event of the OpenBot GitHub App, as Signal relayed it. */
interface WorkflowGitHubEventInput {
  /** The `X-GitHub-Event` header. */
  event: string;
  deliveryId: string;
  /** The decoded JSON body. */
  body: unknown;
}

/** Whether a GitHub trigger of this host watches the event: it is then in the trigger's history. */
type WorkflowGitHubResult = { kind: "saved" } | { kind: "unwatched" };

/** The workflow of a run or a step, and the agents that the run can still reach. */
interface WorkflowRunScope {
  workflowId: string;
  agentIds: string[];
}

interface WorkflowsShape {
  list(): Effect.Effect<WorkflowSummary[], WorkflowFailed>;
  /** Every workflow with its graph, in one read. */
  listWithGraphs(): Effect.Effect<{ summary: WorkflowSummary; graph: WorkflowGraph }[], WorkflowFailed>;
  get(workflowId: string): Effect.Effect<WorkflowDetail, WorkflowFailed>;
  create(input: CreateWorkflowInput): Effect.Effect<WorkflowDetail, WorkflowFailed>;
  rename(input: RenameWorkflowInput): Effect.Effect<WorkflowSummary, WorkflowFailed>;
  remove(workflowId: string): Effect.Effect<void, WorkflowFailed>;
  saveGraph(input: SaveWorkflowGraphInput): Effect.Effect<WorkflowSaveResult, WorkflowFailed>;
  versions(workflowId: string): Effect.Effect<WorkflowVersion[], WorkflowFailed>;
  restoreVersion(input: WorkflowVersionInput): Effect.Effect<WorkflowDetail, WorkflowFailed>;
  /** The graph that a restore of the version would put back, or null when there is no such version. */
  /** The graph that a version keeps, so a person can look at it before a restore. */
  versionGraph(input: WorkflowVersionInput): Effect.Effect<WorkflowGraph, WorkflowFailed>;
  /** Starts a run of the whole workflow, from a trigger, or from one node. Idempotent by request id. */
  startRun(input: StartWorkflowRunInput): Effect.Effect<WorkflowRunDetail, WorkflowFailed>;
  /** Starts the run of a schedule trigger's occurrence; see `workflow-triggers.ts`. */
  startScheduled(start: ScheduledWorkflowStart): Effect.Effect<void, WorkflowFailed>;
  /** Starts the run of a verified webhook request. The same delivery again starts nothing. */
  receiveWebhook(delivery: WorkflowWebhookDelivery): Effect.Effect<WorkflowWebhookResult, WorkflowFailed>;
  /**
   * Starts the runs of a GitHub event, or puts it in the queue of its item. Each trigger records the
   * same delivery once.
   */
  receiveGitHub(event: WorkflowGitHubEventInput): Effect.Effect<WorkflowGitHubResult, WorkflowFailed>;
  /** Records in each GitHub trigger's history that the host got no GitHub events from `from` to `to`. */
  githubOffline(from: Date, to: Date): Effect.Effect<void, WorkflowFailed>;
  githubHistory(workflowId: string): Effect.Effect<WorkflowGitHubHistory, WorkflowFailed>;
  /** Runs a GitHub trigger with the newest item that matches it, as GitHub has it now. */
  githubLastEvent(input: WorkflowGitHubLastEventInput): Effect.Effect<WorkflowRunDetail, WorkflowFailed>;
  /** The repositories that the saved GitHub triggers watch, for the GitHub route at start. */
  githubRepositories(): Effect.Effect<string[], WorkflowFailed>;
  /** Runs one node alone, with the newest answers of the nodes before it. */
  runStep(input: RunWorkflowStepInput): Effect.Effect<WorkflowStep, WorkflowFailed>;
  stopStep(stepId: string): Effect.Effect<void, WorkflowFailed>;
  stopRun(runId: string): Effect.Effect<void, WorkflowFailed>;
  /** Runs a failed or stopped step again with the same input, as its next attempt. */
  retryStep(input: RetryWorkflowStepInput): Effect.Effect<WorkflowStep, WorkflowFailed>;
  decide(input: DecideWorkflowStepInput): Effect.Effect<void, WorkflowFailed>;
  runs(input: WorkflowRunsInput): Effect.Effect<WorkflowRunPage, WorkflowFailed>;
  run(runId: string): Effect.Effect<WorkflowRunDetail, WorkflowFailed>;
  /**
   * The workflow of a run or a step, and the agents that the run graph and the step name, or null when
   * there is no such run or step. A retry or a decision moves the run on its own graph, not the current one.
   */
  workflowOf(ref: { runId: string } | { stepId: string }): Effect.Effect<WorkflowRunScope | null, WorkflowFailed>;
  /** Moves every run that can move now. */
  sweep(): Effect.Effect<void>;
  /** Asks for a sweep when an agent event may have ended a step. Returns at once. */
  notice(event: AgentEvent): Effect.Effect<void>;
  /** Whether a model step generates or a post is on its way now. A restart would cut it off. */
  working(): boolean;
}

class Workflows extends Context.Service<Workflows, WorkflowsShape>()("openbot/backend/Workflows") {
  static layer(dependencies: WorkflowsDependencies) {
    return Layer.effect(
      Workflows,
      Effect.gen(function* () {
        const scope = yield* Scope.Scope;
        const lock = yield* Semaphore.make(1);
        /** One model step at a time, so a run does not take every generation slot of the computer. */
        const generationLock = yield* Semaphore.make(1);
        const { store, runs, github, changed, rearm } = dependencies;
        const now = () => (dependencies.now ?? (() => new Date()))();
        /** The model steps that generate and the posts on their way, by step. */
        const working = new Map<string, Fiber.Fiber<void>>();

        const attempt = <A>(work: () => A) =>
          Effect.try({ try: work, catch: (cause) => new WorkflowFailed({ cause }) });
        const refuse = (code: WorkflowStoreError["code"], message: string) =>
          new WorkflowFailed({ cause: new WorkflowStoreError({ code, message }) });

        const detailOf = (workflowId: string) => {
          const detail = store.detail(workflowId);
          if (!detail) throw new WorkflowStoreError({ code: "missing", message: sourceText("error.workflow.missing") });
          return detail;
        };
        const runDetail = (run: StoredWorkflowRun): WorkflowRunDetail => ({
          run: publicRun(run),
          steps: runs.steps(run.id).map(publicStep),
        });
        const titleOf = (workflowId: string) => store.detail(workflowId)?.summary.title ?? "";
        const settle = (step: StoredWorkflowStep, end: WorkflowStepEnd) => {
          const ended = runs.settleStep(step.id, end, now());
          if (ended) changed(step.workflowId);
          return ended;
        };
        // The sweep and the steps call each other, so this type ends the loop of inferred types.
        const requestSweep = (): Effect.Effect<void> => Effect.forkIn(sweep(), scope).pipe(Effect.asVoid);

        // --- Steps ---------------------------------------------------------------------------------

        /**
         * Sends an agent step's message and keeps the delivery. The key is the step's, so a second
         * attempt after a restart finds the delivery the first one made instead of sending twice.
         */
        const sendAgentStep = Effect.fn("Workflows.sendAgentStep")(function* (step: StoredWorkflowStep) {
          if (!step.agentId) {
            settle(step, { status: "failed", error: sourceText("error.workflow.agentMissing") });
            return;
          }
          const run = step.runId ? runs.run(step.runId) : null;
          const sent = yield* dependencies
            .sendHandoff({
              run: {
                id: step.runId ?? step.id,
                routineId: step.workflowId,
                routineName: titleOf(step.workflowId),
                scheduledFor: run?.scheduledFor ?? run?.startedAt ?? step.createdAt,
              },
              agentId: step.agentId,
              text: step.input,
              idempotencyKey: `workflow-step:${step.id}`,
            })
            .pipe(Effect.exit);
          if (Exit.isSuccess(sent)) {
            runs.attachDelivery(step.id, sent.value, now());
            return;
          }
          logger.warn("A workflow could not send a step to its agent.", {
            stepId: step.id,
            agentId: step.agentId,
            cause: String(sent.cause),
          });
          settle(step, { status: "failed", error: sourceText("error.workflow.handoffFailed") });
        });

        /** Ends an agent step from its delivery. Answers whether the step ended. */
        const settleFromDelivery = (step: StoredWorkflowStep): boolean => {
          if (!step.deliveryId) return false;
          // The agent was deleted while it answered.
          if (!step.agentId)
            return settle(step, { status: "failed", error: sourceText("error.workflow.agentMissing") });
          const delivery = dependencies.delivery(step.deliveryId);
          if (!delivery) return settle(step, { status: "failed", error: sourceText("error.workflow.agentStepEnded") });
          if (delivery.turnId) runs.attachTurn(step.id, delivery.turnId, now());
          if (delivery.status === "completed") {
            if (delivery.error) return settle(step, { status: "failed", error: delivery.error });
            const answer = delivery.turnId ? dependencies.turnAnswer(step.agentId, delivery.turnId) : null;
            // The no-update marker is the routine wording for "nothing to say".
            const output = answer === null || isNoUpdateAnswer(answer) ? "" : answer;
            return settle(step, { status: "done", output });
          }
          if (delivery.status === "cancelled") return settle(step, { status: "stopped", error: delivery.error });
          if (delivery.status === "failed" || delivery.status === "interrupted")
            return settle(step, {
              status: "failed",
              error: delivery.error ?? sourceText("error.workflow.agentStepEnded"),
            });
          return false;
        };

        /** Runs a model step or a condition in a fiber of its own; the pass does not wait for it. */
        const startGeneration = (step: StoredWorkflowStep, node: WorkflowNode): Effect.Effect<void> => {
          const condition = node.kind === "condition";
          const request: WorkflowTextRequest = {
            provider: isAgentProvider(node.fields.provider) ? node.fields.provider : null,
            model: fieldText(node, "model") || null,
            effort: isReasoningEffort(node.fields.effort) ? node.fields.effort : null,
            prompt: condition
              ? conditionPrompt(fieldText(node, "rule"), step.input)
              : modelStepPrompt(fieldText(node, "system"), fieldText(node, "prompt"), step.input),
          };
          const generate = Effect.gen(function* () {
            const result = yield* generationLock.withPermit(dependencies.generateText(request)).pipe(Effect.result);
            if (Result.isFailure(result)) {
              settle(step, { status: "failed", error: result.failure.message });
            } else if (!condition) {
              settle(step, { status: "done", output: result.success });
            } else {
              const branch = conditionAnswer(result.success);
              // A condition hands its input on, so the nodes after it read what it judged.
              settle(
                step,
                branch
                  ? { status: "done", output: step.input, branch }
                  : { status: "failed", error: sourceText("error.workflow.conditionUnclear") },
              );
            }
            yield* requestSweep();
          }).pipe(
            // The step ends before the fiber is forgotten, so a pass never sees it running without one.
            Effect.ensuring(Effect.sync(() => working.delete(step.id))),
          );
          return Effect.forkIn(generate, scope).pipe(
            Effect.tap((fiber) => Effect.sync(() => working.set(step.id, fiber))),
            Effect.asVoid,
          );
        };

        /** Posts an output step's text to its place in a fiber of its own; the pass does not wait for it. */
        const startPost = (step: StoredWorkflowStep, output: WorkflowOutputDelivery): Effect.Effect<void> => {
          const post = Effect.gen(function* () {
            if (!runs.claimOutput(step.id, now())) return;
            const result = yield* dependencies.post(output.connectionId, output.placeId, output.text).pipe(
              // A stop or a defect during the post can leave it in part: the row says so, and does not stay `sending`.
              Effect.onExit((exit) =>
                Exit.isSuccess(exit)
                  ? Effect.void
                  : Effect.gen(function* () {
                      runs.endOutput(step.id, "uncertain", "interrupted", now());
                      // A stop settles its own step, and a restart leaves it to the first pass.
                      if (Cause.hasInterruptsOnly(exit.cause)) return;
                      logger.warn("A workflow output post stopped with a defect.", {
                        stepId: step.id,
                        cause: String(exit.cause),
                      });
                      settle(step, { status: "failed", error: outputError("uncertain") });
                      yield* requestSweep();
                    }),
              ),
            );
            if ("posted" in result) {
              runs.endOutput(step.id, "sent", null, now());
              settle(step, { status: "done", output: step.input });
            } else {
              logger.warn("A workflow output was not posted.", { stepId: step.id, failure: result.failure });
              runs.endOutput(step.id, result.failure === "unknown" ? "uncertain" : "failed", result.failure, now());
              settle(step, { status: "failed", error: outputError(result.failure) });
            }
            yield* requestSweep();
          }).pipe(Effect.ensuring(Effect.sync(() => working.delete(step.id))));
          return Effect.forkIn(post, scope).pipe(
            Effect.tap((fiber) => Effect.sync(() => working.set(step.id, fiber))),
            Effect.asVoid,
          );
        };

        /** Keeps the post of an output to a messaging place, then sends it. */
        const sendOutput = (step: StoredWorkflowStep, node: WorkflowNode): Effect.Effect<void> => {
          const connectionId = fieldText(node, "connectionId");
          const placeId = fieldText(node, "placeId");
          if (!connectionId || !placeId) {
            settle(step, { status: "failed", error: sourceText("error.workflow.outputPlaceMissing") });
            return Effect.void;
          }
          // Nothing to say: the place gets no post, as for a quiet routine run.
          if (!step.input.trim()) {
            settle(step, { status: "done", output: "" });
            return Effect.void;
          }
          if (!dependencies.connectionOn(connectionId)) {
            settle(step, { status: "failed", error: outputError("gone") });
            return Effect.void;
          }
          runs.addOutput(
            { stepId: step.id, connectionId, placeId, text: resultText(titleOf(step.workflowId), step.input) },
            now(),
          );
          const output = runs.output(step.id);
          return output ? startPost(step, output) : Effect.void;
        };

        /**
         * Ends an output step whose post has no fiber, after a restart: a post that did not start is
         * sent now, and one that was on its way may be in the place in part. Answers whether it ended.
         */
        const resumeOutput = (step: StoredWorkflowStep): Effect.Effect<boolean> => {
          const output = runs.output(step.id);
          // The restart came between the step and its post: nothing was sent.
          if (!output)
            return Effect.succeed(settle(step, { status: "failed", error: sourceText("error.workflow.interrupted") }));
          switch (output.status) {
            case "pending":
              return startPost(step, output).pipe(Effect.as(false));
            case "sent":
              return Effect.succeed(settle(step, { status: "done", output: step.input }));
            case "failed":
              return Effect.succeed(settle(step, { status: "failed", error: outputError(output.reason) }));
            case "sending":
              runs.endOutput(step.id, "uncertain", "restart", now());
              return Effect.succeed(settle(step, { status: "failed", error: outputError("uncertain") }));
            case "uncertain":
              return Effect.succeed(settle(step, { status: "failed", error: outputError("uncertain") }));
          }
        };

        /** The key of a GitHub output's change: one for each node of a run, or one for a step that runs alone. */
        const githubActionKey = (step: StoredWorkflowStep) =>
          step.runId ? `${step.runId}:${step.nodeId}` : `step:${step.id}`;

        /**
         * Makes the change of a GitHub output in a fiber of its own; the pass does not wait for it. When the
         * output says "Agent chooses", a model chooses its labels or its person from the repository's first.
         */
        const startGitHubChange = (
          step: StoredWorkflowStep,
          plan: Extract<GitHubOutputPlan, { kind: "change" }>,
          api: WorkflowGitHubApi,
        ): Effect.Effect<void> => {
          const key = githubActionKey(step);
          const repeatable = REPEATABLE_GITHUB_ACTIONS.includes(plan.change.action);
          const work = Effect.gen(function* () {
            let change = plan.change;
            if (plan.choose.labels || plan.choose.person) {
              const options = yield* api.options(change.repository);
              const answer = yield* generationLock.withPermit(
                dependencies.generateText({
                  provider: null,
                  model: null,
                  effort: null,
                  prompt: githubChoicePrompt(step.input, options, plan.choose),
                }),
              );
              const chosen = githubChoices(answer, options, plan.choose);
              if (!chosen) return yield* Effect.fail({ message: sourceText("error.workflow.githubChoseNothing") });
              change = {
                ...change,
                labels: plan.choose.labels ? chosen.labels : change.labels,
                people: plan.choose.person ? chosen.people : change.people,
              };
            }
            github.startAction(
              {
                actionKey: key,
                workflowId: step.workflowId,
                runId: step.runId,
                stepId: step.id,
                repository: change.repository,
                number: change.number,
                action: change.action,
                objectKeys: githubChangeKeys(change),
              },
              now(),
            );
            const result = yield* api.change(change).pipe(
              Effect.tapError(() => Effect.sync(() => github.dropAction(key))),
              // A change that GitHub may have made before the connection broke is not sent again by itself.
              Effect.mapError((failure) => ({
                message:
                  failure.code === "unreachable" && !repeatable
                    ? sourceText("error.workflow.githubUncertain")
                    : failure.message,
              })),
            );
            const created = result.created;
            github.finishAction(
              key,
              created?.kind === "issue" ? created.number : null,
              githubResultKeys(change, result),
              now(),
            );
            return githubOutputText(change, result);
          }).pipe(
            Effect.result,
            Effect.flatMap((result) =>
              Effect.gen(function* () {
                if (Result.isFailure(result)) {
                  logger.warn("A workflow GitHub output made no change.", { stepId: step.id });
                  settle(step, { status: "failed", error: result.failure.message });
                } else settle(step, { status: "done", output: result.success });
                yield* requestSweep();
              }),
            ),
            // A stop or a restart can come while GitHub makes the change: the row stays `sending`, so a
            // restart does not send it again, and the loop guard takes its events as the workflow's own.
            Effect.onExit((exit) =>
              Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause)
                ? Effect.void
                : Effect.gen(function* () {
                    logger.warn("A workflow GitHub output stopped with a defect.", {
                      stepId: step.id,
                      cause: String(exit.cause),
                    });
                    settle(step, { status: "failed", error: sourceText("error.workflow.githubUncertain") });
                    yield* requestSweep();
                  }),
            ),
            Effect.ensuring(Effect.sync(() => working.delete(step.id))),
          );
          return Effect.forkIn(work, scope).pipe(
            Effect.tap((fiber) => Effect.sync(() => working.set(step.id, fiber))),
            Effect.asVoid,
          );
        };

        /**
         * Starts the change of a GitHub output, or ends the step when there is none to make. A change that
         * is done already is not made again. A restart that finds the step's own change on its way sends
         * it again only when a second call repeats nothing.
         */
        const sendGitHub = (
          step: StoredWorkflowStep,
          node: WorkflowNode,
          run: StoredWorkflowRun | null,
        ): Effect.Effect<void> => {
          const api = dependencies.githubApi;
          if (!api) {
            settle(step, { status: "failed", error: sourceText("error.workflow.githubNotConnected") });
            return Effect.void;
          }
          const plan = githubOutputPlan(
            node,
            step.input,
            run?.graph ?? null,
            run?.triggerNodeId ?? null,
            step.runId ? github.runItem(step.runId) : null,
          );
          if (plan.kind === "failed") {
            settle(step, { status: "failed", error: plan.error });
            return Effect.void;
          }
          if (plan.kind === "quiet") {
            settle(step, { status: "done", output: "" });
            return Effect.void;
          }
          const key = githubActionKey(step);
          const record = github.action(key);
          if (record?.status === "done") {
            settle(step, { status: "done", output: githubOutputText({ ...plan.change, number: record.number }, null) });
            return Effect.void;
          }
          if (
            record?.status === "sending" &&
            record.stepId === step.id &&
            !REPEATABLE_GITHUB_ACTIONS.includes(plan.change.action)
          ) {
            github.dropAction(key);
            settle(step, { status: "failed", error: sourceText("error.workflow.githubUncertain") });
            return Effect.void;
          }
          return startGitHubChange(step, plan, api);
        };

        /** Ends or resumes an output step that has no fiber, after a restart. Answers whether it ended. */
        const resumeOutputStep = Effect.fn("Workflows.resumeOutputStep")(function* (step: StoredWorkflowStep) {
          const run = step.runId ? runs.run(step.runId) : null;
          const graph = run?.graph ?? store.detail(step.workflowId)?.graph;
          const node = graph?.nodes.find((candidate) => candidate.id === step.nodeId);
          if (!node || fieldText(node, "target") !== "github") return yield* resumeOutput(step);
          yield* sendGitHub(step, node, run);
          return runs.step(step.id)?.status !== "running";
        });

        /** Does what a new running step of `node` does. */
        const execute = Effect.fn("Workflows.execute")(function* (
          step: StoredWorkflowStep,
          node: WorkflowNode,
          run: StoredWorkflowRun | null,
        ) {
          if (unsupportedNode(node)) {
            settle(step, { status: "failed", error: sourceText("error.workflow.nodeUnsupported") });
            return;
          }
          switch (node.kind) {
            case "trigger":
              settle(step, { status: "done", output: run?.payload ?? "" });
              return;
            case "prompt":
              settle(step, { status: "done", output: fieldText(node, "text") });
              return;
            case "agent":
              yield* sendAgentStep(step);
              return;
            case "llm":
            case "condition":
              yield* startGeneration(step, node);
              return;
            case "approval":
              if (runs.awaitApproval(step.id, now())) {
                changed(step.workflowId);
                dependencies.notify({
                  kind: "approval",
                  workflowId: step.workflowId,
                  workflowTitle: titleOf(step.workflowId),
                  text: fieldText(node, "question"),
                });
              }
              return;
            case "output":
              if (fieldText(node, "target") === "channel") {
                yield* sendOutput(step, node);
                return;
              }
              if (fieldText(node, "target") === "github") {
                yield* sendGitHub(step, node, run);
                return;
              }
              dependencies.notify({
                kind: "output",
                workflowId: step.workflowId,
                workflowTitle: titleOf(step.workflowId),
                text: step.input,
              });
              settle(step, { status: "done", output: step.input });
              return;
            default:
              settle(step, { status: "failed", error: sourceText("error.workflow.nodeUnsupported") });
          }
        });

        /** The text a new step of `node` keeps as its input: the message itself for an agent. */
        const stepInput = (node: WorkflowNode, workflowId: string, inputs: readonly string[]) => {
          const text = inputText(inputs);
          return node.kind === "agent" ? agentStepText(titleOf(workflowId), fieldText(node, "task"), text) : text;
        };

        /** Ends an open step now: its delivery, its generation, then its row. */
        const stopNow = Effect.fn("Workflows.stopNow")(function* (step: StoredWorkflowStep) {
          if (step.deliveryId && step.agentId)
            yield* dependencies.stopDelivery(step.agentId, step.deliveryId).pipe(
              Effect.catch((failure) =>
                Effect.sync(() =>
                  logger.warn("A workflow step's delivery did not stop.", {
                    stepId: step.id,
                    cause: String(failure.cause),
                  }),
                ),
              ),
            );
          const fiber = working.get(step.id);
          if (fiber) yield* Fiber.interrupt(fiber);
          settle(step, { status: "stopped" });
          // A fiber interrupted before it starts never runs its own clean-up.
          working.delete(step.id);
        });

        // --- Runs ----------------------------------------------------------------------------------

        /** The newest attempt of each node of the run. */
        const latestSteps = (runId: string) => {
          const latest = new Map<string, StoredWorkflowStep>();
          for (const step of runs.steps(runId)) {
            const current = latest.get(step.nodeId);
            if (!current || step.attempt >= current.attempt) latest.set(step.nodeId, step);
          }
          return latest;
        };

        const scopeOf = (run: StoredWorkflowRun, latest: ReadonlyMap<string, StoredWorkflowStep>) =>
          runScope(
            run.graph,
            { triggerNodeId: run.triggerNodeId, fromNodeId: run.fromNodeId },
            new Set([...latest.values()].filter((step) => step.status === "done").map((step) => step.nodeId)),
          );

        /** Starts every node of the run that can start now, then sets the run's status. */
        const advance = Effect.fn("Workflows.advance")(function* (runId: string) {
          const run = runs.run(runId);
          if (!run) return;
          const nodes = new Map(run.graph.nodes.map((node) => [node.id, node]));
          let latest = latestSteps(run.id);
          if (run.status !== "stopping") {
            // An instant step can let the nodes after it start in the same pass.
            for (;;) {
              const actions = nextActions(run.graph, scopeOf(run, latest).nodes, latest);
              if (actions.length === 0) break;
              for (const action of actions) {
                const node = nodes.get(action.nodeId);
                if (!node) return;
                const step = runs.addStep(
                  {
                    workflowId: run.workflowId,
                    runId: run.id,
                    nodeId: node.id,
                    kind: node.kind,
                    requestId: `${run.id}:${node.id}:${(latest.get(node.id)?.attempt ?? 0) + 1}`,
                    agentId: nodeAgentId(node),
                    status: action.action === "skip" ? "skipped" : "running",
                    input: action.action === "skip" ? "" : stepInput(node, run.workflowId, action.inputs),
                  },
                  now(),
                );
                changed(run.workflowId);
                if (action.action === "run" && step.status === "running") yield* execute(step, node, run);
              }
              latest = latestSteps(run.id);
            }
          }
          const ends = [...latest.values()];
          const open = ends.filter(isOpenStep);
          const status =
            open.length > 0
              ? run.status === "stopping"
                ? "stopping"
                : open.every((step) => step.status === "approval")
                  ? "approval"
                  : "running"
              : run.status === "stopping"
                ? "stopped"
                : ends.some((step) => step.status === "failed")
                  ? "failed"
                  : ends.some((step) => step.status === "stopped")
                    ? "stopped"
                    : "done";
          const endedAt = now();
          if (!runs.setRunStatus(run.id, status, null, endedAt)) return;
          changed(run.workflowId);
          if (status === "running" || status === "approval" || status === "stopping") return;
          rearm();
          // The next event of the run's item can start now. A manual run with a GitHub event has an item too.
          if (run.source === "github" || github.runItem(run.id)) yield* requestSweep();
          dependencies.runEnded?.({
            runId: run.id,
            status,
            source: run.source,
            startedAt: run.startedAt,
            endedAt: endedAt.toISOString(),
            stepKinds: ends.filter((step) => step.status !== "skipped").map((step) => step.kind),
          });
        });

        const sweepOnce = Effect.fn("Workflows.sweepOnce")(function* () {
          const runIds = new Set<string>();
          for (const run of runs.openRuns()) {
            runIds.add(run.id);
            // A stop holds the lock until its steps end, so open steps here mean a restart cut the stop off.
            if (run.status === "stopping")
              for (const step of runs.steps(run.id)) if (isOpenStep(step)) yield* stopNow(step);
          }
          for (const step of runs.openSteps()) {
            if (step.status !== "running") continue;
            let ended = false;
            if (step.kind === "agent") {
              // A step without a delivery lost its message to a restart between the two writes.
              if (!step.deliveryId) {
                yield* sendAgentStep(step);
                ended = runs.step(step.id)?.status !== "running";
              } else ended = settleFromDelivery(step);
            } else if (step.kind === "llm" || step.kind === "condition" || step.kind === "output") {
              if (working.has(step.id)) continue;
              ended =
                step.kind === "output"
                  ? yield* resumeOutputStep(step)
                  : settle(step, { status: "failed", error: sourceText("error.workflow.interrupted") });
            } else {
              // A restart came between the step and what it does at once, such as an approval's wait.
              const run = step.runId ? runs.run(step.runId) : null;
              const graph = run?.graph ?? store.detail(step.workflowId)?.graph;
              const node = graph?.nodes.find((candidate) => candidate.id === step.nodeId);
              if (node) yield* execute(step, node, run);
              else settle(step, { status: "failed", error: sourceText("error.workflow.nodeMissing") });
              ended = runs.step(step.id)?.status !== "running";
            }
            if (ended && step.runId) runIds.add(step.runId);
          }
          for (const runId of runIds) yield* advance(runId);
          for (const workflowId of github.waitingWorkflows()) yield* startWaiting(workflowId);
        });

        const sweep = coalescedPasses(() =>
          lock.withPermit(sweepOnce()).pipe(
            Effect.catchCause((cause) =>
              Effect.sync(() => logger.warn("A workflow sweep failed.", { cause: String(cause) })),
            ),
            Effect.withSpan("Workflows.sweep"),
          ),
        );

        const notice = Effect.fn("Workflows.notice")(function* (event: AgentEvent) {
          // A deleted agent leaves the steps it was answering without an answer.
          if (event.type !== "turn-completed" && event.type !== "queue-changed" && event.type !== "agents-changed")
            return;
          yield* requestSweep();
        });

        /** A user action, under the same lock as a pass. */
        const locked = <A>(work: Effect.Effect<A, WorkflowFailed>) => lock.withPermit(work);

        // --- Graphs --------------------------------------------------------------------------------

        const list = Effect.fn("Workflows.list")(function* () {
          return yield* attempt(() => store.list());
        });

        const listWithGraphs = Effect.fn("Workflows.listWithGraphs")(function* () {
          return yield* attempt(() => store.listWithGraphs());
        });

        const get = Effect.fn("Workflows.get")(function* (workflowId: string) {
          return yield* attempt(() => detailOf(workflowId));
        });

        const create = Effect.fn("Workflows.create")(function* (input: CreateWorkflowInput) {
          const detail = yield* attempt(() =>
            store.create(
              input.graph
                ? { ...input, graph: prepareWorkflowSchedules(input.graph, dependencies.timezone(), now()) }
                : input,
              now(),
            ),
          );
          changed(detail.summary.id);
          rearm();
          watchGitHub();
          return detail;
        });

        const rename = Effect.fn("Workflows.rename")(function* (input: RenameWorkflowInput) {
          const summary = yield* attempt(() => store.rename(input.workflowId, input.title, now()));
          changed(summary.id);
          return summary;
        });

        const remove = Effect.fn("Workflows.remove")(function* (workflowId: string) {
          yield* locked(
            Effect.gen(function* () {
              // The agents stop working for a workflow that is gone.
              for (const step of runs.openSteps())
                if (step.workflowId === workflowId) yield* stopNow(step).pipe(Effect.ignore);
              const removed = yield* attempt(() => store.remove(workflowId, now()));
              if (!removed) return;
              changed(workflowId);
              rearm();
              watchGitHub();
            }),
          );
        });

        const saveGraph = Effect.fn("Workflows.saveGraph")(function* (input: SaveWorkflowGraphInput) {
          const result = yield* attempt(() =>
            store.saveGraph(
              input.workflowId,
              input.baseRevision,
              prepareWorkflowSchedules(input.graph, dependencies.timezone(), now()),
              now(),
            ),
          );
          // A conflict changed nothing: the editor that saved gets the newer workflow in the answer.
          if (result.ok) {
            changed(input.workflowId);
            rearm();
            watchGitHub();
          }
          return result;
        });

        const versions = Effect.fn("Workflows.versions")(function* (workflowId: string) {
          return yield* attempt(() => {
            detailOf(workflowId);
            return store.versions(workflowId);
          });
        });

        const restoreVersion = Effect.fn("Workflows.restoreVersion")(function* (input: WorkflowVersionInput) {
          const detail = yield* attempt(() => store.restoreVersion(input.workflowId, input.versionId, now()));
          changed(input.workflowId);
          rearm();
          watchGitHub();
          return detail;
        });

        // --- Run actions ---------------------------------------------------------------------------

        /**
         * Starts a run from a node, or from the start of the graph. Call it under the lock. The run, its
         * version, the earlier answers it reuses and `record` are one write, so a failure keeps none.
         */
        const begin = Effect.fn("Workflows.begin")(function* (
          detail: WorkflowDetail,
          from: WorkflowNode | null,
          origin: RunOrigin,
          record: (run: StoredWorkflowRun) => void = () => {},
        ) {
          const start = {
            triggerNodeId: from?.kind === "trigger" ? from.id : null,
            fromNodeId: from && from.kind !== "trigger" ? from.id : null,
          };
          const workflowId = detail.summary.id;
          const answered = runs.latestDone(workflowId);
          const scope = runScope(detail.graph, start, new Set(answered.keys()));
          if (detail.graph.nodes.some((node) => scope.nodes.has(node.id) && unsupportedNode(node)))
            return yield* refuse("refused", sourceText("error.workflow.nodeUnsupported"));
          const started = yield* attempt(() =>
            runs.startRun(
              { workflowId, ...start, ...origin, revision: detail.revision, graph: detail.graph },
              now(),
              (run) => {
                store.addRunVersion(workflowId, detail.revision, detail.graph, now());
                // The nodes before the start give their earlier answers again.
                for (const nodeId of scope.reused) {
                  const earlier = answered.get(nodeId);
                  if (!earlier) continue;
                  runs.addStep(
                    {
                      workflowId,
                      runId: run.id,
                      nodeId,
                      kind: earlier.kind,
                      requestId: `${run.id}:${nodeId}:reused`,
                      agentId: earlier.agentId,
                      status: "done",
                      input: earlier.input,
                      output: earlier.output,
                      branch: earlier.branch,
                    },
                    now(),
                  );
                }
                record(run);
              },
            ),
          );
          if (started.created) {
            changed(workflowId);
            yield* advance(started.run.id);
          }
          return { run: runs.run(started.run.id) ?? started.run, created: started.created };
        });

        const startRun = Effect.fn("Workflows.startRun")(function* (input: StartWorkflowRunInput) {
          return yield* locked(
            Effect.gen(function* () {
              const detail = yield* attempt(() => detailOf(input.workflowId));
              const from = input.fromNodeId ? detail.graph.nodes.find((node) => node.id === input.fromNodeId) : null;
              if (from === undefined) return yield* refuse("missing", sourceText("error.workflow.nodeMissing"));
              const { run } = yield* begin(detail, from, {
                source: "manual",
                scheduledFor: null,
                idempotencyKey: `manual:${input.requestId}`,
                payload: null,
              });
              return runDetail(run);
            }),
          );
        });

        /**
         * Starts the run of one occurrence of a schedule trigger. The store gives no due trigger of a
         * workflow that still runs; a run that opened after that read skips the occurrence.
         */
        const startScheduled = Effect.fn("Workflows.startScheduled")(function* (input: ScheduledWorkflowStart) {
          yield* locked(
            Effect.gen(function* () {
              const detail = store.detail(input.workflowId);
              const trigger = detail?.graph.nodes.find((node) => node.id === input.nodeId);
              if (!detail || trigger?.kind !== "trigger" || trigger.fields.trigger !== "schedule") return;
              if (runs.openRuns().some((run) => run.workflowId === input.workflowId)) return;
              yield* begin(detail, trigger, {
                source: "schedule",
                scheduledFor: input.scheduledFor,
                idempotencyKey: `workflow:${input.nodeId}:${input.scheduledFor}`,
                payload: null,
              });
            }),
          );
        });

        const receiveWebhook = Effect.fn("Workflows.receiveWebhook")(function* (input: WorkflowWebhookDelivery) {
          return yield* locked(
            Effect.gen(function* (): Effect.fn.Return<WorkflowWebhookResult, WorkflowFailed> {
              const { workflowId, nodeId, event } = input;
              const detail = yield* attempt(() => store.detail(workflowId));
              const trigger = detail?.graph.nodes.find((node) => node.id === nodeId);
              if (!detail || trigger?.kind !== "trigger" || trigger.fields.trigger !== "webhook")
                return { kind: "gone" };
              const receipt = { workflowId, nodeId, deliveryId: event.deliveryId, receivedAt: event.receivedAt };
              if (yield* attempt(() => runs.hasWebhookReceipt(receipt))) return { kind: "duplicate" };
              const payload = workflowWebhookPayload(nodeId, event);
              // No receipt, so the sender can send a smaller body with the same delivery ID.
              if (payload.length > INPUT_LIMITS.workflowWebhookPayload) return { kind: "too-large" };
              if (runs.openRuns().some((run) => run.workflowId === workflowId)) {
                yield* attempt(() =>
                  runs.addWebhookReceipt({ ...receipt, status: "ignored", reason: "busy", runId: null }),
                );
                return { kind: "ignored", reason: "busy" };
              }
              const started = yield* begin(
                detail,
                trigger,
                {
                  source: "webhook",
                  scheduledFor: null,
                  idempotencyKey: `webhook:${nodeId}:${event.deliveryId}`,
                  payload,
                },
                (run) => runs.addWebhookReceipt({ ...receipt, status: "started", reason: null, runId: run.id }),
              ).pipe(Effect.result);
              if (Result.isFailure(started)) {
                // A fault of this host fails the request, so the sender sends it again.
                if (!(started.failure.cause instanceof WorkflowStoreError)) return yield* started.failure;
                // The sender cannot change why the graph does not start, so the delivery is kept as done.
                logger.warn("A workflow webhook request did not start a run.", {
                  workflowId,
                  nodeId,
                  cause: String(started.failure.cause),
                });
                yield* attempt(() =>
                  runs.addWebhookReceipt({ ...receipt, status: "ignored", reason: "refused", runId: null }),
                );
                return { kind: "ignored", reason: "refused" };
              }
              if (!started.success.created) return { kind: "duplicate" };
              return { kind: "started", run: publicRun(started.success.run) };
            }),
          );
        });

        // --- GitHub --------------------------------------------------------------------------------

        /** The GitHub triggers of every workflow that name a repository and an event. */
        const githubTriggers = () =>
          store.listWithGraphs().flatMap(({ summary, graph }) =>
            graph.nodes.flatMap((node) => {
              const event = node.fields.event;
              return githubTriggerRepository(node) && isOneOf(WORKFLOW_GITHUB_EVENTS, event)
                ? [{ workflowId: summary.id, node, event }]
                : [];
            }),
          );

        const watchedRepositories = () => [
          ...new Set(githubTriggers().flatMap((trigger) => githubTriggerRepository(trigger.node) ?? [])),
        ];

        /** Tells the GitHub route which repositories the saved triggers watch. The change it follows stays. */
        const watchGitHub = () => {
          const watch = dependencies.watchGitHub;
          if (!watch) return;
          try {
            watch(watchedRepositories());
          } catch (cause) {
            logger.warn("The GitHub triggers could not be read for the GitHub route.", { cause: String(cause) });
          }
        };

        /** Whether a chain of runs that OpenBot's bot caused on the item is long enough to stop. */
        const chainTooLong = (item: Pick<WaitingGitHubDelivery["item"], "repository" | "number">) =>
          github.botRunsSince(item, new Date(now().getTime() - GITHUB_CHAIN_WINDOW_MS)) >= GITHUB_CHAIN_RUNS;

        /**
         * Starts the run of a GitHub event. `record` writes what the event leaves in the trigger's
         * history in the same transaction as the run. Answers null when the graph cannot start.
         */
        const beginGitHub = Effect.fn("Workflows.beginGitHub")(function* (
          detail: WorkflowDetail,
          trigger: WorkflowNode,
          delivery: Pick<WaitingGitHubDelivery, "deliveryId" | "item" | "payload" | "causedByBot">,
          record: (run: StoredWorkflowRun) => void,
        ) {
          const workflowId = detail.summary.id;
          const started = yield* begin(
            detail,
            trigger,
            {
              source: "github",
              scheduledFor: null,
              idempotencyKey: `github:${trigger.id}:${delivery.deliveryId}`,
              payload: delivery.payload,
            },
            (run) => {
              github.addRun({
                runId: run.id,
                workflowId,
                nodeId: trigger.id,
                deliveryId: delivery.deliveryId,
                item: delivery.item,
                causedByBot: delivery.causedByBot,
                startedAt: run.startedAt,
              });
              record(run);
            },
          ).pipe(Effect.result);
          if (Result.isSuccess(started)) return started.success.run;
          // A fault of this host fails the event, so Signal tells GitHub that it was not saved.
          if (!(started.failure.cause instanceof WorkflowStoreError)) return yield* started.failure;
          logger.warn("A GitHub event did not start a workflow run.", {
            workflowId,
            nodeId: trigger.id,
            cause: String(started.failure.cause),
          });
          return null;
        });

        /** Starts the oldest waiting event of each item of the workflow whose run ended. Call it under the lock. */
        const startWaiting = Effect.fn("Workflows.startWaiting")(function* (workflowId: string) {
          const detail = store.detail(workflowId);
          for (const delivery of github.waiting(workflowId)) {
            if (github.runOpen(workflowId, delivery.item)) continue;
            const trigger = detail?.graph.nodes.find(
              (node) => node.id === delivery.nodeId && githubTriggerRepository(node) !== null,
            );
            if (!detail || !trigger) github.endWaiting(delivery, { reason: "refused" });
            else if (delivery.causedByBot && chainTooLong(delivery.item))
              github.endWaiting(delivery, { reason: "chain" });
            else {
              const run = yield* beginGitHub(detail, trigger, delivery, (started) =>
                github.endWaiting(delivery, { runId: started.id }),
              );
              if (!run) github.endWaiting(delivery, { reason: "refused" });
            }
            changed(workflowId);
          }
        });

        const receiveGitHub = Effect.fn("Workflows.receiveGitHub")(function* (input: WorkflowGitHubEventInput) {
          return yield* locked(
            Effect.gen(function* (): Effect.fn.Return<WorkflowGitHubResult, WorkflowFailed> {
              const facts = githubEventFacts(input.event, input.body, dependencies.githubApp());
              if (!facts) return { kind: "unwatched" };
              const receivedAt = now();
              const triggers = (yield* attempt(githubTriggers)).filter((trigger) =>
                githubTriggerMatches(trigger.node, facts),
              );
              if (triggers.length === 0) return { kind: "unwatched" };
              for (const { workflowId, node, event } of triggers) {
                if (yield* attempt(() => github.hasDelivery(workflowId, node.id, input.deliveryId))) continue;
                const delivery = {
                  workflowId,
                  nodeId: node.id,
                  deliveryId: input.deliveryId,
                  event,
                  item: facts.item,
                  receivedAt: receivedAt.toISOString(),
                  causedByBot: facts.causedByBot,
                  runId: null,
                  payload: null,
                };
                const skip = (reason: "filter" | "self" | "chain" | "refused") =>
                  attempt(() => github.addDelivery({ ...delivery, outcome: "skipped", reason }));
                changed(workflowId);
                if (githubFilterRefuses(node, facts)) {
                  yield* skip("filter");
                  continue;
                }
                // Only OpenBot's bot makes the changes of GitHub outputs, so only its events can be a step's own.
                if (
                  facts.causedByBot &&
                  github.selfCaused(
                    workflowId,
                    facts.item,
                    facts.objectKey,
                    new Date(receivedAt.getTime() - GITHUB_SELF_WINDOW_MS),
                  )
                ) {
                  yield* skip("self");
                  continue;
                }
                if (facts.causedByBot && chainTooLong(facts.item)) {
                  yield* skip("chain");
                  continue;
                }
                const payload = workflowGitHubPayload(node.id, input.deliveryId, event, facts, delivery.receivedAt);
                if (github.itemBusy(workflowId, facts.item)) {
                  yield* attempt(() => github.addDelivery({ ...delivery, outcome: "waiting", reason: null, payload }));
                  continue;
                }
                const detail = yield* attempt(() => store.detail(workflowId));
                const run = detail
                  ? yield* beginGitHub(
                      detail,
                      node,
                      { deliveryId: input.deliveryId, item: facts.item, payload, causedByBot: facts.causedByBot },
                      (started) =>
                        github.addDelivery({ ...delivery, outcome: "started", reason: null, runId: started.id }),
                    )
                  : null;
                if (!run) yield* skip("refused");
              }
              return { kind: "saved" };
            }),
          );
        });

        const githubOffline = Effect.fn("Workflows.githubOffline")(function* (from: Date, to: Date) {
          yield* locked(
            Effect.gen(function* () {
              const triggers = yield* attempt(githubTriggers);
              if (triggers.length === 0) return;
              yield* attempt(() =>
                github.addOffline(
                  triggers.map(({ workflowId, node, event }) => ({ workflowId, nodeId: node.id, event })),
                  from,
                  to,
                ),
              );
              for (const workflowId of new Set(triggers.map((trigger) => trigger.workflowId))) changed(workflowId);
            }),
          );
        });

        const githubHistory = Effect.fn("Workflows.githubHistory")(function* (workflowId: string) {
          return yield* attempt(() => {
            detailOf(workflowId);
            return github.history(workflowId);
          });
        });

        const githubLastEvent = Effect.fn("Workflows.githubLastEvent")(function* (input: WorkflowGitHubLastEventInput) {
          const api = dependencies.githubApi;
          if (!api) return yield* refuse("refused", sourceText("error.workflow.githubNotConnected"));
          const detail = yield* attempt(() => detailOf(input.workflowId));
          const trigger = detail.graph.nodes.find((node) => node.id === input.nodeId);
          const repository = trigger ? githubTriggerRepository(trigger) : null;
          const event = trigger?.fields.event;
          if (!trigger || !repository || !isOneOf(WORKFLOW_GITHUB_EVENTS, event))
            return yield* refuse("missing", sourceText("error.workflow.nodeMissing"));
          // GitHub is asked outside the lock: the other runs do not wait for it.
          const recent = yield* api
            .recentEvents(repository, event)
            .pipe(Effect.mapError((failure) => refuse("refused", failure.message)));
          const bot = dependencies.githubApp();
          const facts = recent
            .map((candidate) => githubEventFacts(candidate.event, candidate.body, bot))
            .find(
              (candidate) =>
                candidate !== null &&
                githubTriggerMatches(trigger, candidate) &&
                !githubFilterRefuses(trigger, candidate),
            );
          if (!facts) return yield* refuse("refused", sourceText("error.workflow.githubNoEvent"));
          return yield* locked(
            Effect.gen(function* () {
              const current = yield* attempt(() => detailOf(input.workflowId));
              const node = current.graph.nodes.find((candidate) => candidate.id === trigger.id);
              if (!node || githubTriggerRepository(node) !== repository)
                return yield* refuse("missing", sourceText("error.workflow.nodeMissing"));
              const deliveryId = `last:${input.requestId}`;
              const { run } = yield* begin(
                current,
                node,
                {
                  source: "manual",
                  scheduledFor: null,
                  idempotencyKey: `manual:${input.requestId}`,
                  payload: workflowGitHubPayload(node.id, deliveryId, event, facts, now().toISOString()),
                },
                // A run that a person starts does not wait for the run of its item.
                (started) =>
                  github.addRun({
                    runId: started.id,
                    workflowId: current.summary.id,
                    nodeId: node.id,
                    deliveryId: null,
                    item: facts.item,
                    causedByBot: false,
                    startedAt: started.startedAt,
                  }),
              );
              return runDetail(run);
            }),
          );
        });

        const githubRepositories = Effect.fn("Workflows.githubRepositories")(function* () {
          return yield* attempt(watchedRepositories);
        });

        const runStep = Effect.fn("Workflows.runStep")(function* (input: RunWorkflowStepInput) {
          return yield* locked(
            Effect.gen(function* () {
              const detail = yield* attempt(() => detailOf(input.workflowId));
              const node = detail.graph.nodes.find((candidate) => candidate.id === input.nodeId);
              if (!node) return yield* refuse("missing", sourceText("error.workflow.nodeMissing"));
              if (unsupportedNode(node)) return yield* refuse("refused", sourceText("error.workflow.nodeUnsupported"));
              const inputs = soloInputs(detail.graph, node.id, runs.latestDone(input.workflowId));
              const step = yield* attempt(() =>
                runs.addStep(
                  {
                    workflowId: input.workflowId,
                    runId: null,
                    nodeId: node.id,
                    kind: node.kind,
                    requestId: input.requestId,
                    agentId: nodeAgentId(node),
                    status: "running",
                    input: stepInput(node, input.workflowId, inputs),
                  },
                  now(),
                ),
              );
              changed(input.workflowId);
              if (step.status === "running" && !step.deliveryId && !working.has(step.id))
                yield* execute(step, node, null);
              return publicStep(runs.step(step.id) ?? step);
            }),
          );
        });

        const stopStep = Effect.fn("Workflows.stopStep")(function* (stepId: string) {
          yield* locked(
            Effect.gen(function* () {
              const step = runs.step(stepId);
              if (!step) return yield* refuse("missing", sourceText("error.workflow.stepMissing"));
              if (!isOpenStep(step)) return;
              yield* stopNow(step);
              if (step.runId) yield* advance(step.runId);
            }),
          );
        });

        /** Stops every open step of a run, then the run. */
        const stopRunNow = Effect.fn("Workflows.stopRunNow")(function* (run: StoredWorkflowRun) {
          if (!runs.setRunStatus(run.id, "stopping", null, now())) return;
          changed(run.workflowId);
          for (const step of runs.steps(run.id)) if (isOpenStep(step)) yield* stopNow(step);
          yield* advance(run.id);
        });

        const stopRun = Effect.fn("Workflows.stopRun")(function* (runId: string) {
          yield* locked(
            Effect.gen(function* () {
              const run = runs.run(runId);
              if (!run) return yield* refuse("missing", sourceText("error.workflow.runMissing"));
              yield* stopRunNow(run);
            }),
          );
        });

        const retryStep = Effect.fn("Workflows.retryStep")(function* (input: RetryWorkflowStepInput) {
          return yield* locked(
            Effect.gen(function* () {
              const failed = runs.step(input.stepId);
              if (!failed) return yield* refuse("missing", sourceText("error.workflow.stepMissing"));
              if (failed.status !== "failed" && failed.status !== "stopped")
                return yield* refuse("refused", sourceText("error.workflow.notRetryable"));
              const run = failed.runId ? runs.run(failed.runId) : null;
              const current = (yield* attempt(() => detailOf(failed.workflowId))).graph;
              // The node's current settings, so that a setting fixed after the failure applies. The
              // run's copy when the node is gone or is now another kind.
              const node =
                current.nodes.find((candidate) => candidate.id === failed.nodeId && candidate.kind === failed.kind) ??
                run?.graph.nodes.find((candidate) => candidate.id === failed.nodeId);
              if (!node) return yield* refuse("missing", sourceText("error.workflow.nodeMissing"));
              if (run && runs.reopenRun(run.id, now())) changed(run.workflowId);
              const step = yield* attempt(() =>
                runs.addStep(
                  {
                    workflowId: failed.workflowId,
                    runId: failed.runId,
                    nodeId: failed.nodeId,
                    kind: failed.kind,
                    requestId: input.requestId,
                    agentId: nodeAgentId(node),
                    status: "running",
                    // An agent step's input is its whole message, with the task: build it again.
                    input:
                      node.kind === "agent"
                        ? stepInput(
                            node,
                            failed.workflowId,
                            soloInputs(
                              run?.graph ?? current,
                              failed.nodeId,
                              run ? latestSteps(run.id) : runs.latestDone(failed.workflowId),
                            ),
                          )
                        : failed.input,
                  },
                  now(),
                ),
              );
              changed(failed.workflowId);
              if (step.status === "running" && !step.deliveryId && !working.has(step.id))
                yield* execute(step, node, run);
              if (run) yield* advance(run.id);
              return publicStep(runs.step(step.id) ?? step);
            }),
          );
        });

        const decide = Effect.fn("Workflows.decide")(function* (input: DecideWorkflowStepInput) {
          yield* locked(
            Effect.gen(function* () {
              const step = runs.step(input.stepId);
              if (!step) return yield* refuse("missing", sourceText("error.workflow.stepMissing"));
              if (step.status !== "approval") return yield* refuse("refused", sourceText("error.workflow.noDecision"));
              settle(step, input.approved ? { status: "done", output: step.input } : { status: "stopped" });
              const run = step.runId ? runs.run(step.runId) : null;
              if (!run) return;
              // A rejection stops the whole run.
              if (input.approved) yield* advance(run.id);
              else yield* stopRunNow(run);
            }),
          );
        });

        const runPage = Effect.fn("Workflows.runs")(function* (input: WorkflowRunsInput) {
          return yield* attempt(() => {
            detailOf(input.workflowId);
            return runs.page(input.workflowId, input.before, input.limit);
          });
        });

        const run = Effect.fn("Workflows.run")(function* (runId: string) {
          const found = runs.run(runId);
          if (!found) return yield* refuse("missing", sourceText("error.workflow.runMissing"));
          return yield* attempt(() => runDetail(found));
        });

        const versionGraph = Effect.fn("Workflows.versionGraph")(function* (input: WorkflowVersionInput) {
          const graph = yield* attempt(() => store.versionGraph(input.workflowId, input.versionId));
          if (graph === null) return yield* refuse("missing", sourceText("error.workflow.versionMissing"));
          return graph;
        });

        const workflowOf = Effect.fn("Workflows.workflowOf")(function* (ref: { runId: string } | { stepId: string }) {
          return yield* attempt((): WorkflowRunScope | null => {
            const step = "stepId" in ref ? runs.step(ref.stepId) : null;
            const runId = "runId" in ref ? ref.runId : step?.runId;
            const run = runId ? runs.run(runId) : null;
            const workflowId = step?.workflowId ?? run?.workflowId;
            if (!workflowId) return null;
            const agentIds = new Set(run ? graphAgentIds(run.graph) : []);
            if (step?.agentId) agentIds.add(step.agentId);
            return { workflowId, agentIds: [...agentIds] };
          });
        });

        return Workflows.of({
          list,
          listWithGraphs,
          get,
          create,
          rename,
          remove,
          saveGraph,
          versions,
          restoreVersion,
          versionGraph,
          startRun,
          startScheduled,
          receiveWebhook,
          receiveGitHub,
          githubOffline,
          githubHistory,
          githubLastEvent,
          githubRepositories,
          runStep,
          stopStep,
          stopRun,
          retryStep,
          decide,
          runs: runPage,
          run,
          workflowOf,
          sweep,
          notice,
          working: () => working.size > 0,
        });
      }),
    );
  }
}

export interface WorkflowsHandle extends WorkflowsShape {
  close(): Effect.Effect<void>;
}

/** Starts the service on its own runtime; `close` stops the passes, generations and posts it forked. */
export const createWorkflows = Effect.fn("createWorkflows")(function* (dependencies: WorkflowsDependencies) {
  const runtime = ManagedRuntime.make(Workflows.layer(dependencies));
  const context = yield* runtime.contextEffect.pipe(
    Effect.onExit((exit) => (Exit.isFailure(exit) ? runtime.disposeEffect : Effect.void)),
  );
  const service = Context.get(context, Workflows);
  return { ...service, close: () => runtime.disposeEffect } satisfies WorkflowsHandle;
});

/** What the place gets: the workflow's name over the text. Both are the user's and the agents' own. */
/** The sentence for a post that did not end as sent, from its failure or its kept reason. */
function outputError(reason: string | null): string {
  switch (reason) {
    case "not-running":
      return sourceText("error.workflow.outputNotRunning");
    case "gone":
      return sourceText("error.workflow.outputConnectionOff");
    case "refused":
      return sourceText("error.workflow.outputRefused");
    default:
      return sourceText("error.workflow.outputUncertain");
  }
}
