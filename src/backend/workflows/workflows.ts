import { isAgentProvider } from "@openbot/contracts/agent-providers";
import { attachmentMimeTypeForName } from "@openbot/contracts/attachment-files";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AgentEvent,
  type AgentReasoningEffort,
  type CreateWorkflowInput,
  type DecideWorkflowStepInput,
  fillWorkflowTemplate,
  graphAgentIds,
  isReasoningEffort,
  nodeAgentId,
  parseWorkflowCheck,
  type QueueDeliveryStatus,
  type RenameWorkflowInput,
  type RetryWorkflowStepInput,
  type RunWorkflowStepInput,
  type SaveWorkflowGraphInput,
  type SetWorkflowPausedInput,
  type StartWorkflowRunInput,
  WORKFLOW_CHECK_FIELD,
  WORKFLOW_GITHUB_EVENTS,
  WORKFLOW_PICTURE_TYPES,
  type WorkflowCatalogProvider,
  type WorkflowDetail,
  type WorkflowGitHubHistory,
  type WorkflowGitHubLastEventInput,
  type WorkflowGraph,
  type WorkflowMediaCatalog,
  type WorkflowMediaCredits,
  type WorkflowMediaKind,
  type WorkflowMediaPrice,
  type WorkflowMediaPriceRequest,
  type WorkflowMediaProvider,
  type WorkflowMediaProviders,
  type WorkflowMediaSize,
  type WorkflowMediaSpecs,
  type WorkflowNode,
  type WorkflowNodeKind,
  type WorkflowRun,
  type WorkflowRunDetail,
  type WorkflowRunPage,
  type WorkflowRunSource,
  type WorkflowRunsInput,
  type WorkflowSaveResult,
  type WorkflowStep,
  type WorkflowStepSettings,
  type WorkflowSummary,
  type WorkflowVersion,
  type WorkflowVersionInput,
  workflowAnswerFieldsOf,
  workflowAnswerSources,
  workflowCatalogMediaModel,
  workflowCatalogProvider,
  workflowCheckPasses,
  workflowMediaKind,
  workflowMediaModel,
  workflowMediaSpecs,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isOneOf } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import {
  Cause,
  Context,
  Effect,
  Exit,
  Fiber,
  Layer,
  ManagedRuntime,
  Option,
  Result,
  Schema,
  Scope,
  Semaphore,
} from "effect";
import { isNoUpdateAnswer } from "../agent/routine-quiet-runs";
import type { AgentProvider } from "../agent-client";
import { coalescedPasses } from "../coalesced-passes";
import type {
  MessagingDiscordMention,
  MessagingDiscordSend,
  MessagingMentionResult,
  MessagingPostFailure,
  MessagingSlackMention,
  MessagingSlackSend,
  MessagingTelegramMention,
  MessagingTelegramSend,
} from "../messaging/messaging-threads";
import { resultText } from "../routine-results/routine-results";
import type { ReceivedWebhookEvent } from "../routine-store";
import {
  type DiscordOutputPlan,
  discordOutputPlan,
  discordTriggerFiles,
  discordTriggerMatches,
  discordTriggerMessage,
  workflowDiscordPayload,
} from "./discord-matching";
import {
  type GitHubEventFacts,
  githubEventFacts,
  githubFilterRefuses,
  githubTriggerMatches,
  githubTriggerRepositories,
  withoutStaleGitHubRepositories,
  workflowGitHubPayload,
} from "./github-matching";
import {
  type GitHubOutputFill,
  type GitHubOutputPlan,
  githubChangeKeys,
  githubChoicePrompt,
  githubChoices,
  githubOutputInput,
  githubOutputPlan,
  githubOutputText,
  githubResultKeys,
} from "./github-output";
import {
  type SlackOutputPlan,
  slackOutputPlan,
  slackTriggerMatches,
  slackTriggerMessage,
  workflowSlackPayload,
} from "./slack-matching";
import {
  type TelegramOutputPlan,
  telegramOutputPlan,
  telegramTriggerMatches,
  telegramTriggerMessage,
  workflowTelegramPayload,
} from "./telegram-matching";
import {
  agentAnswerAsk,
  answerFields,
  answerFixAsk,
  answerProblemNames,
  modelAnswerAsk,
  readAnswer,
  readableAnswerInputs,
  readGivenAnswer,
  runInputProblems,
  stepAnswer,
  stepAnswerGap,
  type TemplateReader,
  templateValues,
  toolAnswerFixAsk,
  webhookAnswerEvent,
  withRunAnswerSpec,
  workflowAnswerJsonSchema,
} from "./workflow-answers";
import { REPEATABLE_GITHUB_ACTIONS, type WorkflowGitHubApi } from "./workflow-github-api";
import type { WaitingGitHubDelivery, WorkflowGitHubStore } from "./workflow-github-store";
import { nodeTimezone } from "./workflow-graph";
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
import {
  prepareWorkflowSchedules,
  type ScheduledWorkflowStart,
  workflowScheduleOutput,
  workflowWebhookPayload,
} from "./workflow-triggers";
import {
  agentFileInputs,
  agentHandoffText,
  agentStepText,
  conditionAnswer,
  conditionPrompt,
  currentAnswers,
  endedWithoutAnswer,
  fieldText,
  inputText,
  type MediaImageRole,
  mediaAccount,
  mediaImages,
  mediaInputs,
  mediaStepPrompt,
  mediaVoice,
  modelStepPrompt,
  nextActions,
  runScope,
  soloInputs,
  stepRecord,
  unsupportedNode,
  usedMediaSettings,
} from "./workflow-walk";

const logger = createOpenBotLogger("workflows");

const GITHUB_CHAIN_RUNS = 3;
const GITHUB_CHAIN_WINDOW_MS = 10 * 60_000;
const GITHUB_SELF_WINDOW_MS = 60 * 60_000;
const CREDIT_MEDIA_AT_ONCE = 4;
const SUBSCRIPTION_MEDIA_AT_ONCE = 2;

const paysWithCredits = (provider: WorkflowMediaProvider) => provider === "sunra" || provider === "higgsfield";

class WorkflowFailed extends Schema.TaggedError<WorkflowFailed>()("WorkflowFailed", {
  cause: Schema.Defect(),
}) {}

interface WorkflowDelivery {
  status: QueueDeliveryStatus;
  turnId: string | null;
  error: string | null;
}

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
  images: readonly string[];
  outputSchema?: DynamicRecord;
}

const MODEL_IMAGE_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

interface WorkflowTextChoice {
  provider: AgentProvider;
  model: string;
  effort: AgentReasoningEffort;
}

interface WorkflowMediaRequest {
  kind: WorkflowMediaKind;
  provider: WorkflowMediaProvider;
  model: string;
  catalogId: string;
  account: string | null;
  specs: WorkflowMediaSpecs;
  prompt: string;
  images: readonly { role: MediaImageRole; attachmentId: string }[];
  voice: string | null;
}

type ChatOutputSend = { action: "reply" | "post"; text: string } | { action: "react"; emoji: string };

interface RunOrigin {
  source: WorkflowRunSource;
  scheduledFor: string | null;
  idempotencyKey: string;
  payload: string | null;
}

export interface WorkflowRunEnd {
  runId: string;
  status: "done" | "failed" | "stopped";
  source: WorkflowRunSource;
  startedAt: string;
  endedAt: string;
  stepKinds: WorkflowNodeKind[];
}

export type WorkflowToolAnswer =
  | { kind: "none" }
  | { kind: "several" }
  | { kind: "free" }
  | { kind: "saved" }
  | { kind: "problems"; text: string };

export interface WorkflowsDependencies {
  store: WorkflowStore;
  runs: WorkflowRunStore;
  delivery(deliveryId: string): WorkflowDelivery | null;
  turnAnswer(agentId: string, turnId: string): string | null;
  sendHandoff(input: {
    run: { id: string; routineId: string; routineName: string; scheduledFor: string };
    agentId: string;
    text: string;
    sourcePaths: readonly string[];
    idempotencyKey: string;
  }): Effect.Effect<string, { readonly cause: unknown }>;
  filePath?: (attachmentId: string) => Effect.Effect<string | null, { readonly cause: unknown }>;
  stopDelivery(agentId: string, deliveryId: string): Effect.Effect<void, { readonly cause: unknown }>;
  generateText(request: WorkflowTextRequest): Effect.Effect<string, { readonly message: string }>;
  chooseTextModel?: (
    request: Omit<WorkflowTextRequest, "prompt">,
  ) => Effect.Effect<WorkflowTextChoice, { readonly message: string }>;
  generateMedia?: (request: WorkflowMediaRequest) => Effect.Effect<string, { readonly message: string }>;
  sizePicture?: (attachmentId: string, size: WorkflowMediaSize) => Effect.Effect<string, { readonly message: string }>;
  keepPicture?: (
    draftId: string,
    types: ReadonlySet<string>,
  ) => Effect.Effect<string | "missing" | "type", { readonly cause: unknown }>;
  mediaProviders?: () => WorkflowMediaProviders;
  mediaCredits?: (only?: WorkflowCatalogProvider) => Effect.Effect<WorkflowMediaCredits>;
  mediaCatalog?: (only?: WorkflowCatalogProvider) => Effect.Effect<WorkflowMediaCatalog>;
  mediaPrice?: (request: WorkflowMediaPriceRequest) => Effect.Effect<WorkflowMediaPrice>;
  notify(notice: WorkflowNotice): void;
  connectionOn(connectionId: string): boolean;
  post(
    connectionId: string,
    placeId: string,
    markdown: string,
  ): Effect.Effect<{ posted: true } | { failure: MessagingPostFailure }>;
  channelPost?: (input: {
    operationId: string;
    channelId: string;
    author: { id: string; name: string };
    text: string;
  }) => Effect.Effect<"posted" | "missing" | "archived", { readonly cause: unknown }>;
  discordSend?: (
    connectionId: string,
    send: MessagingDiscordSend,
  ) => Effect.Effect<{ posted: true } | { failure: MessagingPostFailure }>;
  telegramSend?: (
    connectionId: string,
    send: MessagingTelegramSend,
  ) => Effect.Effect<{ posted: true } | { failure: MessagingPostFailure }>;
  slackSend?: (
    connectionId: string,
    send: MessagingSlackSend,
  ) => Effect.Effect<{ posted: true } | { failure: MessagingPostFailure }>;
  changed(workflowId: string, agentId?: string): void;
  rearm(): void;
  timezone(): string;
  runEnded?: (end: WorkflowRunEnd) => void;
  github: WorkflowGitHubStore;
  githubApp(): string | null;
  watchGitHub?: (repositories: string[]) => void;
  githubApi?: WorkflowGitHubApi;
  now?: () => Date;
}

export interface WorkflowWebhookDelivery {
  workflowId: string;
  nodeId: string;
  event: ReceivedWebhookEvent;
}

export type WorkflowWebhookResult =
  | { kind: "started"; run: WorkflowRun }
  | { kind: "ignored"; reason: "busy" | "refused" }
  | { kind: "duplicate" }
  | { kind: "gone" }
  | { kind: "too-large" }
  | { kind: "bad-answer" };

interface WorkflowGitHubEventInput {
  event: string;
  deliveryId: string;
  body: unknown;
}

type WorkflowGitHubResult = { kind: "saved" } | { kind: "unwatched" };

interface WorkflowRunScope {
  workflowId: string;
  agentIds: string[];
}

export function workflowNoticeEvent(event: AgentEvent): boolean {
  return event.type === "turn-completed" || event.type === "queue-changed" || event.type === "agents-changed";
}

interface WorkflowsShape {
  list(): Effect.Effect<WorkflowSummary[], WorkflowFailed>;
  listWithGraphs(): Effect.Effect<{ summary: WorkflowSummary; graph: WorkflowGraph }[], WorkflowFailed>;
  get(workflowId: string): Effect.Effect<WorkflowDetail, WorkflowFailed>;
  create(input: CreateWorkflowInput, agentId?: string): Effect.Effect<WorkflowDetail, WorkflowFailed>;
  createCopy(input: CreateWorkflowInput): Effect.Effect<WorkflowDetail, WorkflowFailed>;
  rename(input: RenameWorkflowInput): Effect.Effect<WorkflowSummary, WorkflowFailed>;
  setPaused(input: SetWorkflowPausedInput): Effect.Effect<WorkflowSummary, WorkflowFailed>;
  remove(workflowId: string): Effect.Effect<void, WorkflowFailed>;
  saveGraph(input: SaveWorkflowGraphInput, agentId?: string): Effect.Effect<WorkflowSaveResult, WorkflowFailed>;
  versions(workflowId: string): Effect.Effect<WorkflowVersion[], WorkflowFailed>;
  restoreVersion(input: WorkflowVersionInput): Effect.Effect<WorkflowDetail, WorkflowFailed>;
  versionGraph(input: WorkflowVersionInput): Effect.Effect<WorkflowGraph, WorkflowFailed>;
  startRun(input: StartWorkflowRunInput, runInput?: string): Effect.Effect<WorkflowRunDetail, WorkflowFailed>;
  startScheduled(start: ScheduledWorkflowStart): Effect.Effect<void, WorkflowFailed>;
  receiveWebhook(delivery: WorkflowWebhookDelivery): Effect.Effect<WorkflowWebhookResult, WorkflowFailed>;
  receiveGitHub(event: WorkflowGitHubEventInput): Effect.Effect<WorkflowGitHubResult, WorkflowFailed>;
  receiveDiscord(mention: MessagingDiscordMention): Effect.Effect<MessagingMentionResult, WorkflowFailed>;
  receiveTelegram(mention: MessagingTelegramMention): Effect.Effect<MessagingMentionResult, WorkflowFailed>;
  receiveSlack(mention: MessagingSlackMention): Effect.Effect<MessagingMentionResult, WorkflowFailed>;
  githubOffline(from: Date, to: Date): Effect.Effect<void, WorkflowFailed>;
  githubHistory(workflowId: string): Effect.Effect<WorkflowGitHubHistory, WorkflowFailed>;
  githubLastEvent(input: WorkflowGitHubLastEventInput): Effect.Effect<WorkflowRunDetail, WorkflowFailed>;
  githubRepositories(): Effect.Effect<string[], WorkflowFailed>;
  keepPicture(draftId: string): Effect.Effect<string, WorkflowFailed>;
  mediaProviders(): WorkflowMediaProviders;
  mediaCredits(only?: WorkflowCatalogProvider): Effect.Effect<WorkflowMediaCredits>;
  mediaCatalog(): Effect.Effect<WorkflowMediaCatalog>;
  mediaPrice(request: WorkflowMediaPriceRequest): Effect.Effect<WorkflowMediaPrice>;
  runStep(input: RunWorkflowStepInput): Effect.Effect<WorkflowStep, WorkflowFailed>;
  stopStep(stepId: string): Effect.Effect<void, WorkflowFailed>;
  stopRun(runId: string): Effect.Effect<void, WorkflowFailed>;
  retryStep(input: RetryWorkflowStepInput): Effect.Effect<WorkflowStep, WorkflowFailed>;
  decide(input: DecideWorkflowStepInput): Effect.Effect<void, WorkflowFailed>;
  runs(input: WorkflowRunsInput): Effect.Effect<WorkflowRunPage, WorkflowFailed>;
  run(runId: string): Effect.Effect<WorkflowRunDetail, WorkflowFailed>;
  stepSettings(stepId: string): Effect.Effect<WorkflowStepSettings, WorkflowFailed>;
  workflowOf(ref: { runId: string } | { stepId: string }): Effect.Effect<WorkflowRunScope | null, WorkflowFailed>;
  giveAnswer(deliveryIds: readonly string[], value: unknown): Effect.Effect<WorkflowToolAnswer, WorkflowFailed>;
  sweep(): Effect.Effect<void>;
  notice(event: AgentEvent): Effect.Effect<void>;
  working(): boolean;
}

class Workflows extends Context.Service<Workflows, WorkflowsShape>()("openbot/backend/Workflows") {
  static layer(dependencies: WorkflowsDependencies) {
    return Layer.effect(
      Workflows,
      Effect.gen(function* () {
        const scope = yield* Scope.Scope;
        const lock = yield* Semaphore.make(1);
        const generationLock = yield* Semaphore.make(1);
        const creditMedia = yield* Semaphore.make(CREDIT_MEDIA_AT_ONCE);
        const subscriptionMedia = yield* Semaphore.make(SUBSCRIPTION_MEDIA_AT_ONCE);
        const { store, runs, github, changed, rearm } = dependencies;
        const now = () => (dependencies.now ?? (() => new Date()))();
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
        const requestSweep = (): Effect.Effect<void> => Effect.forkIn(sweep(), scope).pipe(Effect.asVoid);

        const inputFilePaths = Effect.fn("Workflows.inputFilePaths")(function* (attachmentIds: readonly string[]) {
          if (attachmentIds.length > INPUT_LIMITS.attachments)
            return Result.fail(sourceText("error.backend.attachLimit", { limit: INPUT_LIMITS.attachments }));
          const paths: string[] = [];
          for (const attachmentId of attachmentIds) {
            const path = dependencies.filePath
              ? yield* dependencies.filePath(attachmentId).pipe(Effect.orElseSucceed(() => null))
              : null;
            if (!path) return Result.fail(sourceText("error.workflow.mediaInputMissing"));
            paths.push(path);
          }
          return Result.succeed(paths);
        });

        const sendAgentStep = Effect.fn("Workflows.sendAgentStep")(function* (step: StoredWorkflowStep) {
          if (!step.agentId) {
            settle(step, { status: "failed", error: sourceText("error.workflow.agentMissing") });
            return;
          }
          const run = step.runId ? runs.run(step.runId) : null;
          const graph = run?.graph ?? store.detail(step.workflowId)?.graph;
          const attachmentIds = graph
            ? agentFileInputs(graph, step.nodeId, run ? latestSteps(run.id) : runs.latestDone(step.workflowId))
            : [];
          const resolved = yield* inputFilePaths(attachmentIds);
          if (Result.isFailure(resolved)) {
            settle(step, { status: "failed", error: resolved.failure });
            return;
          }
          const sourcePaths = resolved.success;
          const sent = yield* dependencies
            .sendHandoff({
              run: {
                id: step.runId ?? step.id,
                routineId: step.workflowId,
                routineName: titleOf(step.workflowId),
                scheduledFor: run?.scheduledFor ?? run?.startedAt ?? step.createdAt,
              },
              agentId: step.agentId,
              text: agentHandoffText(step.input, sourcePaths.length),
              sourcePaths,
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

        const askAnswerFix = Effect.fn("Workflows.askAnswerFix")(function* (
          step: StoredWorkflowStep,
          agentId: string,
          deliveryId: string,
          text: string,
        ) {
          const run = step.runId ? runs.run(step.runId) : null;
          const sent = yield* dependencies
            .sendHandoff({
              run: {
                id: step.runId ?? step.id,
                routineId: step.workflowId,
                routineName: titleOf(step.workflowId),
                scheduledFor: run?.scheduledFor ?? run?.startedAt ?? step.createdAt,
              },
              agentId,
              text,
              sourcePaths: [],
              idempotencyKey: `workflow-step:${step.id}:answer`,
            })
            .pipe(Effect.option);
          if (Option.isNone(sent)) return "failed" as const;
          return sent.value !== deliveryId && runs.replaceDelivery(step.id, deliveryId, sent.value, now())
            ? ("sent" as const)
            : ("repeated" as const);
        });

        const settleFromDelivery = Effect.fn("Workflows.settleFromDelivery")(function* (step: StoredWorkflowStep) {
          if (!step.deliveryId) return false;
          if (!step.agentId)
            return settle(step, { status: "failed", error: sourceText("error.workflow.agentMissing") });
          const delivery = dependencies.delivery(step.deliveryId);
          if (!delivery) return settle(step, { status: "failed", error: sourceText("error.workflow.agentStepEnded") });
          if (delivery.turnId) runs.attachTurn(step.id, delivery.turnId, now());
          if (delivery.status === "completed") {
            if (delivery.error) return settle(step, { status: "failed", error: delivery.error });
            const fields = answerFields(step.settings);
            if (fields.length > 0 && step.output !== null) return settle(step, { status: "done", output: step.output });
            const answer = delivery.turnId ? dependencies.turnAnswer(step.agentId, delivery.turnId) : null;
            const output = answer === null || isNoUpdateAnswer(answer) ? "" : answer;
            if (fields.length === 0) return settle(step, { status: "done", output });
            const read = readAnswer(fields, output);
            if ("output" in read) return settle(step, { status: "done", output: read.output });
            const fix = yield* askAnswerFix(step, step.agentId, step.deliveryId, answerFixAsk(fields, read.problems));
            if (fix === "sent") {
              changed(step.workflowId);
              return false;
            }
            if (fix === "failed")
              return settle(step, { status: "failed", error: sourceText("error.workflow.handoffFailed") });
            return settle(step, {
              status: "failed",
              error: sourceText("error.workflow.answerInvalid", { fields: answerProblemNames(read.problems) }),
            });
          }
          if (delivery.status === "cancelled") return settle(step, { status: "stopped", error: delivery.error });
          if (delivery.status === "failed" || delivery.status === "interrupted")
            return settle(step, {
              status: "failed",
              error: delivery.error ?? sourceText("error.workflow.agentStepStopped"),
            });
          return false;
        });

        const modelStepImages = Effect.fn("Workflows.modelStepImages")(function* (
          step: StoredWorkflowStep,
          run: StoredWorkflowRun | null,
        ) {
          const graph = run?.graph ?? store.detail(step.workflowId)?.graph;
          const inputs = graph
            ? mediaInputs(graph, step.nodeId, run ? latestSteps(run.id) : runs.latestDone(step.workflowId))
            : [];
          const paths = yield* inputFilePaths([...new Set(inputs.map((input) => input.attachmentId))]);
          if (
            Result.isSuccess(paths) &&
            paths.success.some((path) => !MODEL_IMAGE_TYPES.has(attachmentMimeTypeForName(path)))
          )
            return Result.fail(sourceText("error.workflow.modelImageType"));
          return paths;
        });

        const startGeneration = (
          step: StoredWorkflowStep,
          node: WorkflowNode,
          run: StoredWorkflowRun | null,
        ): Effect.Effect<void> => {
          const condition = node.kind === "condition";
          const generate = Effect.gen(function* () {
            const images = condition ? Result.succeed([]) : yield* modelStepImages(step, run);
            if (Result.isFailure(images)) {
              settle(step, { status: "failed", error: images.failure });
              yield* requestSweep();
              return;
            }
            const fields = condition ? [] : workflowAnswerFieldsOf(node);
            const values = condition ? new Map<string, string>() : templateValuesOf(step, run);
            const prompt = condition
              ? conditionPrompt(fieldText(node, "rule"), step.input)
              : modelStepPrompt(
                  fillWorkflowTemplate(fieldText(node, "system"), values),
                  fillWorkflowTemplate(fieldText(node, "prompt"), values),
                  step.input,
                );
            const request: WorkflowTextRequest = {
              provider: isAgentProvider(node.fields.provider) ? node.fields.provider : null,
              model: fieldText(node, "model") || null,
              effort: isReasoningEffort(node.fields.effort) ? node.fields.effort : null,
              prompt: fields.length > 0 ? `${prompt}\n\n${modelAnswerAsk(fields)}` : prompt,
              images: images.success,
              ...(fields.length > 0 ? { outputSchema: workflowAnswerJsonSchema(fields) } : {}),
            };
            const chosen = Effect.gen(function* () {
              if (!dependencies.chooseTextModel) return request;
              const choice = yield* dependencies.chooseTextModel(request);
              runs.recordUsedSettings(step.id, { ...choice });
              return { ...request, ...choice };
            });
            const ready = yield* chosen.pipe(Effect.result);
            const generated = (prompt: string) =>
              Result.isFailure(ready)
                ? Effect.fail(ready.failure)
                : generationLock.withPermit(dependencies.generateText({ ...ready.success, prompt }));
            const result = yield* generated(request.prompt).pipe(Effect.result);
            if (Result.isFailure(result)) {
              settle(step, { status: "failed", error: result.failure.message });
            } else if (fields.length > 0) {
              const first = readAnswer(fields, result.success);
              const fixed =
                "output" in first
                  ? Result.succeed(first)
                  : yield* generated(
                      `${request.prompt}\n\n--- your answer ---\n${result.success}\n\n${answerFixAsk(fields, first.problems)}`,
                    ).pipe(
                      Effect.map((text) => readAnswer(fields, text)),
                      Effect.result,
                    );
              if (Result.isFailure(fixed)) settle(step, { status: "failed", error: fixed.failure.message });
              else if ("output" in fixed.success) settle(step, { status: "done", output: fixed.success.output });
              else
                settle(step, {
                  status: "failed",
                  error: sourceText("error.workflow.answerInvalid", {
                    fields: answerProblemNames(fixed.success.problems),
                  }),
                });
            } else if (!condition) {
              settle(step, { status: "done", output: result.success });
            } else {
              const branch = conditionAnswer(result.success);
              settle(
                step,
                branch
                  ? { status: "done", output: step.input, branch }
                  : { status: "failed", error: sourceText("error.workflow.conditionUnclear") },
              );
            }
            yield* requestSweep();
          }).pipe(Effect.ensuring(Effect.sync(() => working.delete(step.id))));
          return Effect.forkIn(generate, scope).pipe(
            Effect.tap((fiber) => Effect.sync(() => working.set(step.id, fiber))),
            Effect.asVoid,
          );
        };

        const startMedia = (
          step: StoredWorkflowStep,
          node: WorkflowNode,
          run: StoredWorkflowRun | null,
        ): Effect.Effect<void> => {
          const kind = workflowMediaKind(node.fields);
          const generateMedia = dependencies.generateMedia;
          const sizePicture = dependencies.sizePicture;
          const sized = (specs: WorkflowMediaSpecs) => (attachmentId: string) =>
            specs.size && sizePicture
              ? sizePicture(attachmentId, specs.size).pipe(
                  Effect.catch((failure) =>
                    Effect.sync(() => {
                      logger.warn("A workflow image could not be cropped to its size.", { error: failure.message });
                      return attachmentId;
                    }),
                  ),
                )
              : Effect.succeed(attachmentId);
          const graph = run?.graph ?? store.detail(step.workflowId)?.graph;
          const inputs = graph
            ? mediaInputs(graph, node.id, run ? latestSteps(run.id) : runs.latestDone(step.workflowId))
            : [];
          const images = mediaImages(node.fields, kind, inputs);
          const empty = !fieldText(node, "prompt").trim() && !step.input.trim() && images.length === 0;
          const make = Effect.gen(function* () {
            const service =
              !empty && typeof node.fields.model === "string" ? workflowCatalogProvider(node.fields.model) : null;
            const live = service
              ? (yield* mediaCatalog(service)).models.flatMap((entry) => workflowCatalogMediaModel(entry) ?? [])
              : [];
            const model = workflowMediaModel(node.fields, live);
            const specs = workflowMediaSpecs(node.fields, kind, model);
            if (model && !empty && generateMedia)
              runs.recordUsedSettings(step.id, usedMediaSettings(kind, model, specs));
            const result = empty
              ? Result.fail({ message: sourceText("error.workflow.mediaEmptyRequest") })
              : !generateMedia || !model
                ? Result.fail({ message: sourceText("error.workflow.nodeUnsupported") })
                : yield* (paysWithCredits(model.provider) ? creditMedia : subscriptionMedia)
                    .withPermit(
                      generateMedia({
                        kind,
                        provider: model.provider,
                        model: model.providerModel ?? model.id,
                        catalogId: model.id,
                        account: mediaAccount(node.fields),
                        specs,
                        prompt: mediaStepPrompt(node.fields, kind, step.input, specs, model.provider),
                        images,
                        voice: mediaVoice(node.fields, kind, model),
                      }).pipe(Effect.flatMap(sized(specs))),
                    )
                    .pipe(Effect.result);
            if (Result.isFailure(result)) settle(step, { status: "failed", error: result.failure.message });
            else settle(step, { status: "done", output: result.success });
            yield* requestSweep();
          }).pipe(Effect.ensuring(Effect.sync(() => working.delete(step.id))));
          return Effect.forkIn(make, scope).pipe(
            Effect.tap((fiber) => Effect.sync(() => working.set(step.id, fiber))),
            Effect.asVoid,
          );
        };

        const startPost = (
          step: StoredWorkflowStep,
          output: WorkflowOutputDelivery,
          send = dependencies.post(output.connectionId, output.placeId, output.text),
        ): Effect.Effect<void> => {
          const post = Effect.gen(function* () {
            if (!runs.claimOutput(step.id, now())) return;
            const result = yield* send.pipe(
              Effect.onExit((exit) =>
                Exit.isSuccess(exit)
                  ? Effect.void
                  : Effect.gen(function* () {
                      runs.endOutput(step.id, "uncertain", "interrupted", now());
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

        const sendOutput = (step: StoredWorkflowStep, node: WorkflowNode): Effect.Effect<void> => {
          const connectionId = fieldText(node, "connectionId");
          const placeId = fieldText(node, "placeId");
          if (!connectionId || !placeId) {
            settle(step, { status: "failed", error: sourceText("error.workflow.outputPlaceMissing") });
            return Effect.void;
          }
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

        const sendChannelNote = Effect.fn("Workflows.sendChannelNote")(function* (
          step: StoredWorkflowStep,
          node: WorkflowNode,
        ) {
          const channelId = fieldText(node, "channelId");
          if (!channelId) {
            settle(step, { status: "failed", error: sourceText("error.workflow.outputChannelMissing") });
            return;
          }
          if (!step.input.trim()) {
            settle(step, { status: "done", output: "" });
            return;
          }
          if (!dependencies.channelPost) {
            settle(step, { status: "failed", error: sourceText("error.workflow.outputChannelFailed") });
            return;
          }
          const posted = yield* dependencies
            .channelPost({
              operationId: step.id,
              channelId,
              author: {
                id: `workflow:${step.workflowId}`,
                name: titleOf(step.workflowId).slice(0, INPUT_LIMITS.accountName),
              },
              text: step.input,
            })
            .pipe(
              Effect.catch((failure) =>
                Effect.sync(() => {
                  logger.warn("A workflow output could not post into a channel.", { cause: String(failure.cause) });
                  return "failed" as const;
                }),
              ),
            );
          if (posted === "posted") settle(step, { status: "done", output: step.input });
          else
            settle(step, {
              status: "failed",
              error: sourceText(
                posted === "archived"
                  ? "error.backend.channelArchived"
                  : posted === "missing"
                    ? "error.backend.channelNotFound"
                    : "error.workflow.outputChannelFailed",
              ),
            });
        });

        const resumeOutput = (
          step: StoredWorkflowStep,
          send?: Effect.Effect<{ posted: true } | { failure: MessagingPostFailure }>,
        ): Effect.Effect<boolean> => {
          const output = runs.output(step.id);
          if (!output)
            return Effect.succeed(settle(step, { status: "failed", error: sourceText("error.workflow.interrupted") }));
          switch (output.status) {
            case "pending":
              return startPost(step, output, send).pipe(Effect.as(false));
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

        const discordPlan = (step: StoredWorkflowStep, node: WorkflowNode, run: StoredWorkflowRun | null) =>
          discordOutputPlan(node, step.input, run?.source === "discord" ? discordTriggerMessage(run.payload) : null);

        const discordPost = (plan: Extract<DiscordOutputPlan, { send: unknown }>) =>
          dependencies.discordSend
            ? dependencies.discordSend(plan.connectionId, plan.send)
            : Effect.succeed({ failure: "not-running" as const });

        const sendChat = <Plan extends { connectionId: string; send: ChatOutputSend }>(
          step: StoredWorkflowStep,
          plan: Plan | { error: string },
          placeId: (plan: Plan) => string,
          post: (plan: Plan) => Effect.Effect<{ posted: true } | { failure: MessagingPostFailure }>,
        ) => {
          if ("error" in plan) {
            settle(step, { status: "failed", error: plan.error });
            return Effect.void;
          }
          const { send } = plan;
          if (send.action !== "react" && !send.text.trim()) {
            settle(step, { status: "done", output: "" });
            return Effect.void;
          }
          if (!dependencies.connectionOn(plan.connectionId)) {
            settle(step, { status: "failed", error: outputError("gone") });
            return Effect.void;
          }
          runs.addOutput(
            {
              stepId: step.id,
              connectionId: plan.connectionId,
              placeId: placeId(plan),
              text: send.action === "react" ? send.emoji : send.text,
            },
            now(),
          );
          const output = runs.output(step.id);
          return output ? startPost(step, output, post(plan)) : Effect.void;
        };

        const sendDiscord = (step: StoredWorkflowStep, node: WorkflowNode, run: StoredWorkflowRun | null) =>
          sendChat(step, discordPlan(step, node, run), (plan) => plan.send.channelId, discordPost);

        const telegramPlan = (step: StoredWorkflowStep, node: WorkflowNode, run: StoredWorkflowRun | null) =>
          telegramOutputPlan(node, step.input, run?.source === "telegram" ? telegramTriggerMessage(run.payload) : null);

        const telegramPost = (plan: Extract<TelegramOutputPlan, { send: unknown }>) =>
          dependencies.telegramSend
            ? dependencies.telegramSend(plan.connectionId, plan.send)
            : Effect.succeed({ failure: "not-running" as const });

        const sendTelegram = (step: StoredWorkflowStep, node: WorkflowNode, run: StoredWorkflowRun | null) =>
          sendChat(step, telegramPlan(step, node, run), (plan) => plan.chatId, telegramPost);

        const slackPlan = (step: StoredWorkflowStep, node: WorkflowNode, run: StoredWorkflowRun | null) =>
          slackOutputPlan(node, step.input, run?.source === "slack" ? slackTriggerMessage(run.payload) : null);

        const slackPost = (plan: Extract<SlackOutputPlan, { send: unknown }>) =>
          dependencies.slackSend
            ? dependencies.slackSend(plan.connectionId, plan.send)
            : Effect.succeed({ failure: "not-running" as const });

        const sendSlack = (step: StoredWorkflowStep, node: WorkflowNode, run: StoredWorkflowRun | null) =>
          sendChat(step, slackPlan(step, node, run), (plan) => plan.send.channelId, slackPost);

        const githubActionKey = (step: StoredWorkflowStep) => {
          if (!step.runId) return `step:${step.id}`;
          const pass = runs
            .steps(step.runId)
            .filter((other) => other.nodeId === step.nodeId && other.status === "done" && other.id !== step.id).length;
          return `${step.runId}:${step.nodeId}:${pass}`;
        };

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
                  images: [],
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
            change = yield* api.attachFiles(change);
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
                  logger.warn("A workflow GitHub output failed.", { stepId: step.id });
                  settle(step, { status: "failed", error: result.failure.message });
                } else settle(step, { status: "done", output: result.success });
                yield* requestSweep();
              }),
            ),
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
            run?.source === "discord" ? discordTriggerFiles(run.payload) : null,
            fillOf(step, run),
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

        const resumeOutputStep = Effect.fn("Workflows.resumeOutputStep")(function* (step: StoredWorkflowStep) {
          const run = step.runId ? runs.run(step.runId) : null;
          const graph = run?.graph ?? store.detail(step.workflowId)?.graph;
          const node = graph?.nodes.find((candidate) => candidate.id === step.nodeId);
          if (node && fieldText(node, "target") === "discord") {
            const plan = discordPlan(step, node, run);
            if ("error" in plan) return settle(step, { status: "failed", error: plan.error });
            return yield* resumeOutput(step, discordPost(plan));
          }
          if (node && fieldText(node, "target") === "telegram") {
            const plan = telegramPlan(step, node, run);
            if ("error" in plan) return settle(step, { status: "failed", error: plan.error });
            return yield* resumeOutput(step, telegramPost(plan));
          }
          if (node && fieldText(node, "target") === "slack") {
            const plan = slackPlan(step, node, run);
            if ("error" in plan) return settle(step, { status: "failed", error: plan.error });
            return yield* resumeOutput(step, slackPost(plan));
          }
          if (node && fieldText(node, "target") === "chat-channel") {
            yield* sendChannelNote(step, node);
            return runs.step(step.id)?.status !== "running";
          }
          if (!node || fieldText(node, "target") !== "github") return yield* resumeOutput(step);
          yield* sendGitHub(step, node, run);
          return runs.step(step.id)?.status !== "running";
        });

        const triggerOutput = (node: WorkflowNode, run: StoredWorkflowRun | null): string => {
          if (run?.payload) return run.payload;
          if (!run || node.fields.trigger !== "schedule") return "";
          return workflowScheduleOutput(
            run.scheduledFor ?? run.startedAt,
            nodeTimezone(node) ?? dependencies.timezone(),
          );
        };

        const execute = Effect.fn("Workflows.execute")(function* (
          step: StoredWorkflowStep,
          node: WorkflowNode,
          run: StoredWorkflowRun | null,
        ) {
          if (unsupportedNode(node)) {
            settle(step, { status: "failed", error: sourceText("error.workflow.nodeUnsupported") });
            return;
          }
          const gap = answerGapOf(step, node, run);
          if (gap) {
            settle(step, { status: "failed", error: gap });
            return;
          }
          switch (node.kind) {
            case "trigger":
              settle(step, { status: "done", output: triggerOutput(node, run) });
              return;
            case "prompt":
              settle(step, { status: "done", output: fieldText(node, "text") });
              return;
            case "agent":
              yield* sendAgentStep(step);
              return;
            case "condition":
              if (fieldText(node, WORKFLOW_CHECK_FIELD).trim()) {
                const check = parseWorkflowCheck(fieldText(node, WORKFLOW_CHECK_FIELD));
                settle(
                  step,
                  check
                    ? {
                        status: "done",
                        output: step.input,
                        branch: workflowCheckPasses(check, answerOf(step, run)) ? "yes" : "no",
                      }
                    : { status: "failed", error: sourceText("error.workflow.checkInvalid") },
                );
                return;
              }
              yield* startGeneration(step, node, run);
              return;
            case "llm":
              yield* startGeneration(step, node, run);
              return;
            case "image":
              yield* startMedia(step, node, run);
              return;
            case "asset":
              settle(step, { status: "done", output: fieldText(node, "fileId") });
              return;
            case "approval":
              if (runs.awaitApproval(step.id, now())) {
                changed(step.workflowId);
                dependencies.notify({
                  kind: "approval",
                  workflowId: step.workflowId,
                  workflowTitle: titleOf(step.workflowId),
                  text: fillWorkflowTemplate(fieldText(node, "question"), templateValuesOf(step, run, "person")),
                });
              }
              return;
            case "output":
              if (fieldText(node, "target") === "channel") {
                yield* sendOutput(step, node);
                return;
              }
              if (fieldText(node, "target") === "chat-channel") {
                yield* sendChannelNote(step, node);
                return;
              }
              if (fieldText(node, "target") === "github") {
                yield* sendGitHub(step, node, run);
                return;
              }
              if (fieldText(node, "target") === "discord") {
                yield* sendDiscord(step, node, run);
                return;
              }
              if (fieldText(node, "target") === "telegram") {
                yield* sendTelegram(step, node, run);
                return;
              }
              if (fieldText(node, "target") === "slack") {
                yield* sendSlack(step, node, run);
                return;
              }
              dependencies.notify({
                kind: "output",
                workflowId: step.workflowId,
                workflowTitle: fillOf(step, run)(fieldText(node, "title"), "person").trim() || titleOf(step.workflowId),
                text: step.input,
              });
              settle(step, { status: "done", output: step.input });
              return;
            default:
              settle(step, { status: "failed", error: sourceText("error.workflow.nodeUnsupported") });
          }
        });

        const stepGraph = (step: StoredWorkflowStep, run: StoredWorkflowRun | null) => {
          const graph = run?.graph ?? store.detail(step.workflowId)?.graph;
          return graph ? { graph, latest: run ? latestSteps(run.id) : runs.latestDone(step.workflowId) } : null;
        };
        const answerOf = (step: StoredWorkflowStep, run: StoredWorkflowRun | null) => {
          const found = stepGraph(step, run);
          return found ? stepAnswer(found.graph, step.nodeId, found.latest) : {};
        };
        const answerGapOf = (step: StoredWorkflowStep, node: WorkflowNode, run: StoredWorkflowRun | null) => {
          const found = stepGraph(step, run);
          if (!found) return null;
          const gap = stepAnswerGap(found.graph, node, (nodeId) =>
            endedWithoutAnswer(found.graph, nodeId, found.latest),
          );
          if (!gap) return null;
          return gap.kind === "setup"
            ? sourceText("error.workflow.answerSetup", { fields: gap.names })
            : sourceText("error.workflow.answerSourceEnded", { fields: gap.names });
        };
        const templateValuesOf = (
          step: StoredWorkflowStep,
          run: StoredWorkflowRun | null,
          reader: TemplateReader = "model",
        ) => {
          const found = stepGraph(step, run);
          return found ? templateValues(found.graph, step.nodeId, found.latest, reader) : new Map<string, string>();
        };
        const fillOf = (step: StoredWorkflowStep, run: StoredWorkflowRun | null): GitHubOutputFill => {
          const values = new Map<TemplateReader, ReadonlyMap<string, string>>();
          return (text, reader) => {
            if (!text.includes("{{")) return text;
            const known = values.get(reader) ?? templateValuesOf(step, run, reader);
            values.set(reader, known);
            return fillWorkflowTemplate(text, known);
          };
        };

        const stepInput = (
          node: WorkflowNode,
          workflowId: string,
          inputs: readonly string[],
          graph: WorkflowGraph,
          latest: ReadonlyMap<string, StoredWorkflowStep>,
        ) => {
          if (node.kind === "output") {
            const message = fieldText(node, "message");
            const filled = message.trim()
              ? fillWorkflowTemplate(message, templateValues(graph, node.id, latest, "person"))
              : null;
            if (fieldText(node, "target") === "github") return githubOutputInput(inputs, filled);
            return filled ?? inputText(readableAnswerInputs(graph, node.id, latest, inputs));
          }
          const text = inputText(inputs);
          if (node.kind !== "agent") return text;
          const task = fillWorkflowTemplate(fieldText(node, "task"), templateValues(graph, node.id, latest));
          const fields = workflowAnswerFieldsOf(node);
          return agentStepText(
            titleOf(workflowId),
            fields.length > 0
              ? `${task.trim() || "Do this step of the workflow with the input below."}\n\n${agentAnswerAsk(fields)}`
              : task,
            text,
          );
        };

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
          working.delete(step.id);
        });

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

        const answerGraphs = () => {
          const read = new Map<string, { graph: WorkflowGraph; steps: StoredWorkflowStep[] } | null>();
          return (step: StoredWorkflowStep) => {
            if (step.runId === null) return undefined;
            let run = read.get(step.runId);
            if (run === undefined) {
              const found = runs.run(step.runId);
              run = found ? { graph: found.graph, steps: runs.steps(found.id) } : null;
              read.set(step.runId, run);
            }
            const retry = run?.steps.some(
              (earlier) =>
                earlier.nodeId === step.nodeId &&
                earlier.attempt === step.attempt - 1 &&
                (earlier.status === "failed" || earlier.status === "stopped"),
            );
            return run && !retry ? run.graph : undefined;
          };
        };

        const advance = Effect.fn("Workflows.advance")(function* (runId: string) {
          const run = runs.run(runId);
          if (!run) return;
          const nodes = new Map(run.graph.nodes.map((node) => [node.id, node]));
          let latest = latestSteps(run.id);
          if (run.status !== "stopping") {
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
                    input:
                      action.action === "skip" ? "" : stepInput(node, run.workflowId, action.inputs, run.graph, latest),
                    ...(action.action === "run" ? stepRecord(run.graph, node, latest) : {}),
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
            if (run.status === "stopping")
              for (const step of runs.steps(run.id)) if (isOpenStep(step)) yield* stopNow(step);
          }
          for (const step of runs.openSteps()) {
            if (step.status !== "running") continue;
            let ended = false;
            if (step.kind === "agent") {
              if (!step.deliveryId) {
                yield* sendAgentStep(step);
                ended = runs.step(step.id)?.status !== "running";
              } else ended = yield* settleFromDelivery(step);
            } else if (
              step.kind === "llm" ||
              step.kind === "condition" ||
              step.kind === "image" ||
              step.kind === "output"
            ) {
              if (working.has(step.id)) continue;
              ended =
                step.kind === "output"
                  ? yield* resumeOutputStep(step)
                  : settle(step, { status: "failed", error: sourceText("error.workflow.interrupted") });
            } else {
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
          if (!workflowNoticeEvent(event)) return;
          yield* requestSweep();
        });

        const locked = <A>(work: Effect.Effect<A, WorkflowFailed>) => lock.withPermit(work);

        const list = Effect.fn("Workflows.list")(function* () {
          return yield* attempt(() => store.list());
        });

        const listWithGraphs = Effect.fn("Workflows.listWithGraphs")(function* () {
          return yield* attempt(() => store.listWithGraphs());
        });

        const prepareGraph = (graph: WorkflowGraph) =>
          withoutStaleGitHubRepositories(prepareWorkflowSchedules(graph, dependencies.timezone(), now()));

        const get = Effect.fn("Workflows.get")(function* (workflowId: string) {
          return yield* attempt(() => detailOf(workflowId));
        });

        const announceCreated = (detail: WorkflowDetail, agentId?: string) => {
          changed(detail.summary.id, agentId);
          rearm();
          watchGitHub();
          return detail;
        };

        const create = Effect.fn("Workflows.create")(function* (input: CreateWorkflowInput, agentId?: string) {
          const detail = yield* attempt(() =>
            store.create(input.graph ? { ...input, graph: prepareGraph(input.graph) } : input, now()),
          );
          return announceCreated(detail, agentId);
        });

        const createCopy = Effect.fn("Workflows.createCopy")(function* (input: CreateWorkflowInput) {
          const detail = yield* attempt(() =>
            store.create(input.graph ? { ...input, graph: prepareGraph(input.graph) } : input, now(), "saved"),
          );
          return announceCreated(detail);
        });

        const rename = Effect.fn("Workflows.rename")(function* (input: RenameWorkflowInput) {
          const summary = yield* attempt(() => store.rename(input.workflowId, input.title, now()));
          changed(summary.id);
          return summary;
        });

        const setPaused = Effect.fn("Workflows.setPaused")(function* (input: SetWorkflowPausedInput) {
          const summary = yield* attempt(() => store.setPaused(input.workflowId, input.paused, now()));
          changed(summary.id);
          rearm();
          watchGitHub();
          return summary;
        });

        const remove = Effect.fn("Workflows.remove")(function* (workflowId: string) {
          yield* locked(
            Effect.gen(function* () {
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

        const saveGraph = Effect.fn("Workflows.saveGraph")(function* (input: SaveWorkflowGraphInput, agentId?: string) {
          const result = yield* attempt(() =>
            store.saveGraph(input.workflowId, input.baseRevision, prepareGraph(input.graph), now()),
          );
          if (result.ok) {
            changed(input.workflowId, agentId);
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
          const answered = currentAnswers(detail.graph, runs.latestDone(workflowId), answerGraphs());
          const scope = runScope(detail.graph, start, new Set(answered.keys()));
          if (detail.graph.nodes.some((node) => scope.nodes.has(node.id) && unsupportedNode(node)))
            return yield* refuse("refused", sourceText("error.workflow.nodeUnsupported"));
          const started = yield* attempt(() =>
            runs.startRun(
              { workflowId, ...start, ...origin, revision: detail.revision, graph: detail.graph },
              now(),
              (run) => {
                store.addRunVersion(workflowId, detail.revision, detail.graph, now());
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
                      settings: earlier.settings,
                      sources: earlier.sources,
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

        const startRun = Effect.fn("Workflows.startRun")(function* (input: StartWorkflowRunInput, runInput?: string) {
          return yield* locked(
            Effect.gen(function* () {
              const detail = yield* attempt(() => detailOf(input.workflowId));
              const from = input.fromNodeId ? detail.graph.nodes.find((node) => node.id === input.fromNodeId) : null;
              if (from === undefined) return yield* refuse("missing", sourceText("error.workflow.nodeMissing"));
              const given = runInput?.trim() ? runInput : null;
              const triggers = from ? [from] : detail.graph.nodes;
              const problems =
                given === null
                  ? []
                  : triggers.flatMap((node) => (node.kind === "trigger" ? runInputProblems(node, given) : []));
              if (problems.length > 0)
                return yield* refuse(
                  "refused",
                  sourceText("error.workflow.runInputInvalid", { fields: answerProblemNames(problems) }),
                );
              const { run } = yield* begin(detail, from, {
                source: "manual",
                scheduledFor: null,
                idempotencyKey: `manual:${input.requestId}`,
                payload: runInput ?? null,
              });
              return runDetail(run);
            }),
          );
        });

        const startScheduled = Effect.fn("Workflows.startScheduled")(function* (input: ScheduledWorkflowStart) {
          yield* locked(
            Effect.gen(function* () {
              const detail = store.detail(input.workflowId);
              const trigger = detail?.graph.nodes.find((node) => node.id === input.nodeId);
              if (!detail || trigger?.kind !== "trigger" || trigger.fields.trigger !== "schedule") return;
              if (detail.summary.paused) return;
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
              if (detail.summary.paused) {
                yield* attempt(() =>
                  runs.addWebhookReceipt({ ...receipt, status: "ignored", reason: "refused", runId: null }),
                );
                return { kind: "ignored", reason: "refused" };
              }
              const checked = webhookAnswerEvent(trigger, event);
              if ("problems" in checked) {
                logger.warn("A workflow webhook request did not match the trigger's answer fields.", {
                  workflowId,
                  nodeId,
                  fields: answerProblemNames(checked.problems),
                });
                return { kind: "bad-answer" };
              }
              const payload = workflowWebhookPayload(nodeId, checked.event);
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
                if (!(started.failure.cause instanceof WorkflowStoreError)) return yield* started.failure;
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

        const receiveMention = (chat: {
          matches: (node: WorkflowNode) => boolean;
          sameMessage: (run: StoredWorkflowRun) => boolean;
          origin: (node: WorkflowNode) => Omit<RunOrigin, "scheduledFor">;
          failure: string;
        }) =>
          locked(
            Effect.gen(function* (): Effect.fn.Return<MessagingMentionResult, WorkflowFailed> {
              const triggers = (yield* attempt(() => store.listWithGraphs())).flatMap(({ summary, graph }) =>
                summary.paused
                  ? []
                  : graph.nodes.filter(chat.matches).map((node) => ({ workflowId: summary.id, node })),
              );
              if (triggers.length === 0) return "none";
              let started = false;
              for (const { workflowId, node } of triggers) {
                const open = runs.openRuns().filter((run) => run.workflowId === workflowId);
                if (open.some(chat.sameMessage)) {
                  started = true;
                  continue;
                }
                if (open.length > 0) continue;
                const detail = yield* attempt(() => store.detail(workflowId));
                if (!detail) continue;
                const result = yield* begin(detail, node, { ...chat.origin(node), scheduledFor: null }).pipe(
                  Effect.result,
                );
                if (Result.isFailure(result)) {
                  if (!started && !(result.failure.cause instanceof WorkflowStoreError)) return yield* result.failure;
                  logger.warn(chat.failure, { workflowId, nodeId: node.id, cause: String(result.failure.cause) });
                  continue;
                }
                started = true;
              }
              return started ? "started" : "skipped";
            }),
          );

        const receiveDiscord = Effect.fn("Workflows.receiveDiscord")(function* (mention: MessagingDiscordMention) {
          return yield* receiveMention({
            matches: (node) => discordTriggerMatches(node, mention),
            sameMessage: (run) =>
              run.source === "discord" && discordTriggerMessage(run.payload)?.messageId === mention.messageId,
            origin: (node) => ({
              source: "discord",
              idempotencyKey: `discord:${node.id}:${mention.messageId}`,
              payload: workflowDiscordPayload(node.id, mention),
            }),
            failure: "A Discord mention did not start a workflow run.",
          });
        });

        const receiveTelegram = Effect.fn("Workflows.receiveTelegram")(function* (mention: MessagingTelegramMention) {
          return yield* receiveMention({
            matches: (node) => telegramTriggerMatches(node, mention),
            sameMessage: (run) => {
              const message = run.source === "telegram" ? telegramTriggerMessage(run.payload) : null;
              return message?.connectionId === mention.connectionId && message.messageId === mention.messageId;
            },
            origin: (node) => ({
              source: "telegram",
              idempotencyKey: `telegram:${node.id}:${mention.connectionId}:${mention.messageId}`,
              payload: workflowTelegramPayload(node.id, mention),
            }),
            failure: "A Telegram message did not start a workflow run.",
          });
        });

        const receiveSlack = Effect.fn("Workflows.receiveSlack")(function* (mention: MessagingSlackMention) {
          return yield* receiveMention({
            matches: (node) => slackTriggerMatches(node, mention),
            sameMessage: (run) => {
              const message = run.source === "slack" ? slackTriggerMessage(run.payload) : null;
              return message?.channelId === mention.channelId && message.messageId === mention.messageId;
            },
            origin: (node) => ({
              source: "slack",
              idempotencyKey: `slack:${node.id}:${mention.channelId}:${mention.messageId}`,
              payload: workflowSlackPayload(node.id, mention),
            }),
            failure: "A Slack mention did not start a workflow run.",
          });
        });

        const githubTriggers = () =>
          store.listWithGraphs().flatMap(({ summary, graph }) =>
            (summary.paused ? [] : graph.nodes).flatMap((node) => {
              const event = node.fields.event;
              return githubTriggerRepositories(node).length > 0 && isOneOf(WORKFLOW_GITHUB_EVENTS, event)
                ? [{ workflowId: summary.id, node, event }]
                : [];
            }),
          );

        const watchedRepositories = () => [
          ...new Set(githubTriggers().flatMap((trigger) => githubTriggerRepositories(trigger.node))),
        ];

        const watchGitHub = () => {
          const watch = dependencies.watchGitHub;
          if (!watch) return;
          try {
            watch(watchedRepositories());
          } catch (cause) {
            logger.warn("The GitHub triggers could not be read for the GitHub route.", { cause: String(cause) });
          }
        };

        const chainTooLong = (item: Pick<WaitingGitHubDelivery["item"], "repository" | "number">) =>
          github.botRunsSince(item, new Date(now().getTime() - GITHUB_CHAIN_WINDOW_MS)) >= GITHUB_CHAIN_RUNS;

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
          if (!(started.failure.cause instanceof WorkflowStoreError)) return yield* started.failure;
          logger.warn("A GitHub event did not start a workflow run.", {
            workflowId,
            nodeId: trigger.id,
            cause: String(started.failure.cause),
          });
          return null;
        });

        const startWaiting = Effect.fn("Workflows.startWaiting")(function* (workflowId: string) {
          const detail = store.detail(workflowId);
          for (const delivery of github.waiting(workflowId)) {
            if (github.runOpen(workflowId, delivery.item)) continue;
            const repository = delivery.item.repository.toLowerCase();
            const trigger = detail?.graph.nodes.find(
              (node) =>
                node.id === delivery.nodeId &&
                githubTriggerRepositories(node).some((name) => name.toLowerCase() === repository),
            );
            if (!detail || !trigger || detail.summary.paused) github.endWaiting(delivery, { reason: "refused" });
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
          const repositories = trigger ? githubTriggerRepositories(trigger) : [];
          const event = trigger?.fields.event;
          if (!trigger || repositories.length === 0 || !isOneOf(WORKFLOW_GITHUB_EVENTS, event))
            return yield* refuse("missing", sourceText("error.workflow.nodeMissing"));
          const bot = dependencies.githubApp();
          let facts: GitHubEventFacts | undefined;
          let failure: string | null = null;
          for (const repository of repositories) {
            const answer = yield* api.recentEvents(repository, event).pipe(
              Effect.map((recent) => ({ recent, failure: null })),
              Effect.catch((error) => Effect.succeed({ recent: [], failure: error.message })),
            );
            failure = answer.failure ?? failure;
            facts = answer.recent
              .map((candidate) => githubEventFacts(candidate.event, candidate.body, bot))
              .find(
                (candidate): candidate is GitHubEventFacts =>
                  candidate !== null &&
                  githubTriggerMatches(trigger, candidate) &&
                  !githubFilterRefuses(trigger, candidate),
              );
            if (facts) break;
          }
          if (!facts) return yield* refuse("refused", failure ?? sourceText("error.workflow.githubNoEvent"));
          const found = facts;
          const repository = found.repository.toLowerCase();
          return yield* locked(
            Effect.gen(function* () {
              const current = yield* attempt(() => detailOf(input.workflowId));
              const node = current.graph.nodes.find((candidate) => candidate.id === trigger.id);
              if (!node || !githubTriggerRepositories(node).some((name) => name.toLowerCase() === repository))
                return yield* refuse("missing", sourceText("error.workflow.nodeMissing"));
              const deliveryId = `last:${input.requestId}`;
              const { run } = yield* begin(
                current,
                node,
                {
                  source: "manual",
                  scheduledFor: null,
                  idempotencyKey: `manual:${input.requestId}`,
                  payload: workflowGitHubPayload(node.id, deliveryId, event, found, now().toISOString()),
                },
                (started) =>
                  github.addRun({
                    runId: started.id,
                    workflowId: current.summary.id,
                    nodeId: node.id,
                    deliveryId: null,
                    item: found.item,
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

        const keepPicture = Effect.fn("Workflows.keepPicture")(function* (draftId: string) {
          const keep = dependencies.keepPicture;
          if (!keep) return yield* refuse("refused", sourceText("error.workflow.nodeUnsupported"));
          const kept = yield* keep(draftId, WORKFLOW_PICTURE_TYPES).pipe(
            Effect.mapError(({ cause }) => new WorkflowFailed({ cause })),
          );
          if (kept === "missing") return yield* refuse("missing", sourceText("error.workflow.pictureMissing"));
          if (kept === "type") return yield* refuse("refused", sourceText("error.workflow.pictureType"));
          return kept;
        });

        const mediaProviders = (): WorkflowMediaProviders =>
          dependencies.mediaProviders?.() ?? { sunra: false, higgsfield: false, accounts: null };
        const mediaCredits = (only?: WorkflowCatalogProvider): Effect.Effect<WorkflowMediaCredits> =>
          dependencies.mediaCredits?.(only) ?? Effect.succeed({ sunra: null, higgsfield: null, accounts: null });
        const mediaCatalog = (only?: WorkflowCatalogProvider): Effect.Effect<WorkflowMediaCatalog> =>
          dependencies.mediaCatalog?.(only) ?? Effect.succeed({ models: [] });
        const mediaPrice = (request: WorkflowMediaPriceRequest): Effect.Effect<WorkflowMediaPrice> =>
          dependencies.mediaPrice?.(request) ?? Effect.succeed({ credits: null });

        const runStep = Effect.fn("Workflows.runStep")(function* (input: RunWorkflowStepInput) {
          return yield* locked(
            Effect.gen(function* () {
              const detail = yield* attempt(() => detailOf(input.workflowId));
              const node = detail.graph.nodes.find((candidate) => candidate.id === input.nodeId);
              if (!node) return yield* refuse("missing", sourceText("error.workflow.nodeMissing"));
              if (unsupportedNode(node)) return yield* refuse("refused", sourceText("error.workflow.nodeUnsupported"));
              const settled = runs.latestSettled(input.workflowId);
              const sourceIds = [
                ...detail.graph.edges.flatMap((edge) => (edge.to === node.id ? [edge.from] : [])),
                ...workflowAnswerSources(detail.graph, node.id).map((source) => source.node.id),
              ];
              const ended = (id: string) => {
                const status = settled.get(id)?.status;
                return status === "failed" || status === "stopped";
              };
              if (sourceIds.some(ended)) return yield* refuse("refused", sourceText("error.workflow.sourceNotDone"));
              const answered = runs.latestDone(input.workflowId);
              const inputs = soloInputs(detail.graph, node.id, answered);
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
                    input: stepInput(node, input.workflowId, inputs, detail.graph, answered),
                    ...stepRecord(detail.graph, node, answered),
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
              const ranNode = run?.graph.nodes.find((candidate) => candidate.id === failed.nodeId);
              const currentNode = current.nodes.find(
                (candidate) => candidate.id === failed.nodeId && candidate.kind === failed.kind,
              );
              const node = currentNode ? withRunAnswerSpec(currentNode, ranNode) : ranNode;
              if (!node) return yield* refuse("missing", sourceText("error.workflow.nodeMissing"));
              if (run && runs.reopenRun(run.id, now())) changed(run.workflowId);
              const graph = run?.graph ?? current;
              const latest = run ? latestSteps(run.id) : runs.latestDone(failed.workflowId);
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
                    input:
                      node.kind === "agent"
                        ? stepInput(node, failed.workflowId, soloInputs(graph, failed.nodeId, latest), graph, latest)
                        : failed.input,
                    ...stepRecord(graph, node, latest),
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

        const stepSettings = Effect.fn("Workflows.stepSettings")(function* (stepId: string) {
          const step = yield* attempt(() => runs.step(stepId));
          if (!step) return yield* refuse("missing", sourceText("error.workflow.stepMissing"));
          return { settings: step.settings, sources: step.sources && [...step.sources] };
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

        const giveAnswer = Effect.fn("Workflows.giveAnswer")(function* (
          deliveryIds: readonly string[],
          value: unknown,
        ) {
          return yield* attempt((): WorkflowToolAnswer => {
            const steps = deliveryIds.flatMap((deliveryId) => {
              const step = runs.runningAgentStep(deliveryId);
              return step ? [{ step, deliveryId }] : [];
            });
            const [found, ...others] = steps;
            if (!found) return { kind: "none" };
            if (others.length > 0) return { kind: "several" };
            const fields = answerFields(found.step.settings);
            if (fields.length === 0) return { kind: "free" };
            const read = readGivenAnswer(fields, value);
            if ("problems" in read) return { kind: "problems", text: toolAnswerFixAsk(fields, read.problems) };
            if (!runs.keepAgentAnswer(found.step.id, found.deliveryId, read.output, now())) return { kind: "none" };
            changed(found.step.workflowId);
            return { kind: "saved" };
          });
        });

        return Workflows.of({
          list,
          listWithGraphs,
          get,
          create,
          createCopy,
          rename,
          setPaused,
          remove,
          saveGraph,
          versions,
          restoreVersion,
          versionGraph,
          startRun,
          startScheduled,
          receiveWebhook,
          receiveGitHub,
          receiveDiscord,
          receiveTelegram,
          receiveSlack,
          githubOffline,
          githubHistory,
          githubLastEvent,
          githubRepositories,
          keepPicture,
          mediaProviders,
          mediaCredits,
          mediaCatalog,
          mediaPrice,
          runStep,
          stopStep,
          stopRun,
          retryStep,
          decide,
          runs: runPage,
          run,
          stepSettings,
          workflowOf,
          giveAnswer,
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

export const createWorkflows = Effect.fn("createWorkflows")(function* (dependencies: WorkflowsDependencies) {
  const runtime = ManagedRuntime.make(Workflows.layer(dependencies));
  const context = yield* runtime.contextEffect.pipe(
    Effect.onExit((exit) => (Exit.isFailure(exit) ? runtime.disposeEffect : Effect.void)),
  );
  const service = Context.get(context, Workflows);
  return { ...service, close: () => runtime.disposeEffect } satisfies WorkflowsHandle;
});

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
