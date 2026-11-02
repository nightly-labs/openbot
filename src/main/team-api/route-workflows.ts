import {
  type AgentAccessLevel,
  canAdministerServer,
  graphAgentIds,
  type WorkflowDetail,
  type WorkflowGraph,
  type WorkflowRunDetail,
  type WorkflowRunPage,
  type WorkflowStep,
} from "@openbot/contracts/ipc";
import {
  WORKFLOWS_GITHUB_CAPABILITY,
  WORKFLOWS_GITHUB_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-github-v1";
import {
  WORKFLOW_RUN_STEP_LIMIT,
  WORKFLOW_STEP_TEXT_LIMIT,
  WORKFLOWS_CAPABILITY,
  WORKFLOWS_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-v1";
import { sourceText } from "@openbot/i18n/source";
import { RoutineInputError } from "@openbot/team-client/routine-schedule";
import type { Effect } from "effect";
import { runCauseEffect } from "../../backend/effect-boundary";
import { WorkflowStoreError } from "../../backend/workflows/workflow-store";
import {
  parseCreateWorkflow,
  parseDecideWorkflowStep,
  parseRenameWorkflow,
  parseRetryWorkflowStep,
  parseRunWorkflowStep,
  parseSaveWorkflowGraph,
  parseStartWorkflowRun,
  parseWorkflowGitHubLastEvent,
  parseWorkflowGitHubRepository,
  parseWorkflowRuns,
  parseWorkflowTrigger,
  parseWorkflowVersion,
} from "../ipc/workflow-inputs";
import type { TeamApiAgents, TeamApiWorkflows } from "./dependencies";
import { HttpError } from "./http-error";
import { isPeerHiddenProvider } from "./provider-visibility";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, requireAgentLevel, stringField, WEBRTC_FRAME_BODY_BUDGET } from "./request-helpers";
import { runEventsEffect } from "./route-events";

const WORKFLOW_PATHS = new Set<string>(Object.values(WORKFLOWS_ROUTES));
const WORKFLOW_GITHUB_PATHS = new Set<string>(Object.values(WORKFLOWS_GITHUB_ROUTES));

function workflowMissing(): never {
  throw new HttpError(404, sourceText("error.workflow.missing"));
}

/** The wire codec has already checked the body, so only a malformed payload fails here, in English. */
function parse<A>(decode: (value: unknown) => A, body: unknown): A {
  try {
    return decode(body);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid workflow request.");
  }
}

/**
 * A workflow refused by the store, such as a cycle, or a schedule that cannot run, is the member's
 * sentence. Anything else is a host fault.
 */
async function run<A>(operation: Effect.Effect<A, { readonly cause: unknown }>): Promise<A> {
  try {
    return await runCauseEffect(operation);
  } catch (error) {
    if (error instanceof WorkflowStoreError) throw new HttpError(error.code === "missing" ? 404 : 400, error.message);
    if (error instanceof RoutineInputError) throw new HttpError(400, error.message);
    throw error;
  }
}

/** The messaging place of each output node that posts to one, by node. */
function placeOutputs(graph: WorkflowGraph): Map<string, string> {
  const places = new Map<string, string>();
  for (const node of graph.nodes) {
    if (node.kind !== "output" || node.fields.target !== "channel") continue;
    places.set(node.id, JSON.stringify([node.fields.connectionId ?? null, node.fields.placeId ?? null]));
  }
  return places;
}

/**
 * The settings of each GitHub trigger and each GitHub output, by node. Their changes act as the host's
 * GitHub App bot, so only an owner or admin can add or change one (`workflows-github-v1`).
 */
function githubNodes(graph: WorkflowGraph): Map<string, string> {
  const nodes = new Map<string, string>();
  for (const node of graph.nodes) {
    const github =
      node.kind === "trigger"
        ? node.fields.trigger === "github"
        : node.kind === "output" && node.fields.target === "github";
    if (!github) continue;
    const fields = Object.keys(node.fields)
      .sort()
      .map((key) => [key, node.fields[key] ?? null]);
    nodes.set(node.id, JSON.stringify([node.kind, fields]));
  }
  return nodes;
}

function clip(text: string | null): string | null {
  return text !== null && text.length > WORKFLOW_STEP_TEXT_LIMIT ? text.slice(0, WORKFLOW_STEP_TEXT_LIMIT) : text;
}

function bytesOf(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function fitted<A>(value: A): A {
  if (bytesOf(value) > WEBRTC_FRAME_BODY_BUDGET) throw new HttpError(413, sourceText("error.workflow.tooLargeToSend"));
  return value;
}

/**
 * `whole`, with the step texts of `lists` emptied in order while it would not fit one frame. Each list
 * belongs to `whole`, and it changes in place.
 */
function trimmed<A>(whole: A, lists: readonly WorkflowStep[][]): A {
  let bytes = bytesOf(whole);
  for (const steps of lists)
    for (const [index, step] of steps.entries()) {
      if (bytes <= WEBRTC_FRAME_BODY_BUDGET) return whole;
      const blank: WorkflowStep = { ...step, output: null, error: null };
      bytes -= bytesOf(step) - bytesOf(blank);
      steps[index] = blank;
    }
  return fitted(whole);
}

/**
 * The workflows of a server, their versions and their runs, for a member. A member reads and uses a
 * workflow only when every agent of its agent steps, and every provider of its model steps, is visible
 * to them; otherwise it answers as missing. The answer filter in `provider-visibility.ts` would drop
 * the settings of such a node, and the member's save would then lose them. An owner or admin also
 * sees a workflow whose agent was deleted, so that they can fix or delete it. A run or a decision
 * needs the chat level for each of those agents; a change, a delete or a restore needs the manage
 * level, before and after the change. A graph that names no agent needs no level, by product decision.
 * A change to an output that posts to a messaging place needs an owner or admin, as routine results
 * do. Frozen by `workflows-v1`. A GitHub trigger or a GitHub output, and the GitHub catalog and
 * options, need an owner or admin; the GitHub event history needs a member who reads the workflow, and
 * a run with the last event needs the chat level, as a start does. Frozen by `workflows-github-v1`.
 */
export async function routeWorkflows(
  context: TeamApiRequestContext,
  workflows: TeamApiWorkflows | undefined,
  agents: Pick<TeamApiAgents, "listAgents">,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json, protocol } = context;
  const path = url.pathname;
  const githubPath = WORKFLOW_GITHUB_PATHS.has(path);
  if (method !== "POST" || !(githubPath || WORKFLOW_PATHS.has(path))) return "unmatched";
  if (!workflows || !capabilities.has(WORKFLOWS_CAPABILITY))
    throw new HttpError(400, sourceText("error.workflow.serverTooOld"));
  const github = workflows.github;
  if (githubPath && (!github || !capabilities.has(WORKFLOWS_GITHUB_CAPABILITY)))
    throw new HttpError(400, sourceText("error.workflow.serverTooOld"));
  // `readJson` has already run the body through the workflows wire codec.
  const body = await readJson(request);
  const admin = canAdministerServer(member.role);
  const listed = () => new Set(agents.listAgents().map((agent) => agent.id));

  const visibleAgents = (agentIds: readonly string[], known: ReadonlySet<string>) =>
    agentIds.every((agentId) => !hiddenAgentIds.has(agentId) && (admin || known.has(agentId)));
  const visibleGraph = (graph: WorkflowGraph, known: ReadonlySet<string>) =>
    visibleAgents(graphAgentIds(graph), known) &&
    graph.nodes.every((node) => !isPeerHiddenProvider(node.fields.provider, protocol));
  /** A graph that the member can read and use at `level`, or a 404 as for a missing workflow. */
  const requireUsable = (graph: WorkflowGraph, level: Exclude<AgentAccessLevel, "none">) => {
    if (!visibleGraph(graph, listed())) workflowMissing();
    for (const agentId of graphAgentIds(graph)) requireAgentLevel(context, agentId, level);
  };
  const requireChange = (before: WorkflowGraph, after: WorkflowGraph) => {
    requireUsable(before, "manage");
    requireUsable(after, "manage");
    const old = placeOutputs(before);
    for (const [nodeId, place] of placeOutputs(after)) if (old.get(nodeId) !== place) requireAdmin(member);
    const oldGitHub = githubNodes(before);
    for (const [nodeId, settings] of githubNodes(after)) if (oldGitHub.get(nodeId) !== settings) requireAdmin(member);
  };
  const visibleDetail = async (workflowId: string) => {
    const detail = await run(workflows.get(workflowId));
    if (!visibleGraph(detail.graph, listed())) workflowMissing();
    return detail;
  };
  const usableDetail = async (workflowId: string, level: Exclude<AgentAccessLevel, "none">) => {
    const detail = await visibleDetail(workflowId);
    requireUsable(detail.graph, level);
    return detail;
  };
  /**
   * The workflow of a run or a step that the member can run: its current graph, and the
   * agents of the run graph that a retry or a decision moves on. Otherwise a 404 as for a missing run.
   */
  const usableRunOf = async (ref: { runId: string } | { stepId: string }) => {
    const missing = () =>
      new HttpError(404, sourceText("runId" in ref ? "error.workflow.runMissing" : "error.workflow.stepMissing"));
    const scope = await run(workflows.workflowOf(ref));
    if (scope === null) throw missing();
    await usableDetail(scope.workflowId, "chat");
    if (!visibleAgents(scope.agentIds, listed())) throw missing();
    for (const agentId of scope.agentIds) requireAgentLevel(context, agentId, "chat");
  };

  const memberDetail = (detail: WorkflowDetail): WorkflowDetail => {
    const result = admin
      ? detail
      : { ...detail, triggers: detail.triggers.map((trigger) => ({ ...trigger, webhookUrl: null })) };
    if (bytesOf(result) > WEBRTC_FRAME_BODY_BUDGET)
      throw new HttpError(413, sourceText("error.workflow.tooLargeToSend"));
    return result;
  };
  /** A step's texts, clipped. The answer filter drops a step of an agent hidden from the member. */
  const memberStep = (step: WorkflowStep): WorkflowStep => ({
    ...step,
    output: clip(step.output),
    error: clip(step.error),
  });
  const memberRun = (detail: WorkflowRunDetail): WorkflowRunDetail => ({
    run: { ...detail.run, error: clip(detail.run.error) },
    steps: detail.steps.slice(-WORKFLOW_RUN_STEP_LIMIT).map(memberStep),
  });
  /** The run, with the texts of its oldest steps emptied first while it would not fit one frame. */
  const fittedRun = (detail: WorkflowRunDetail): WorkflowRunDetail => {
    const result = memberRun(detail);
    return trimmed(result, [result.steps]);
  };
  /** The page, with the step texts of the oldest runs emptied first while it would not fit one frame. */
  const memberPage = (page: WorkflowRunPage): WorkflowRunPage => {
    const result: WorkflowRunPage = {
      runs: page.runs.map(memberRun),
      soloSteps: page.soloSteps.map(memberStep),
      nextBefore: page.nextBefore,
    };
    // The page lists the newest run first.
    return trimmed(result, [...result.runs.map((detail) => detail.steps).reverse(), result.soloSteps]);
  };
  /**
   * One step for the member. The answer filter would empty the whole answer for a step of an agent
   * hidden from them, so that step answers as missing.
   */
  const soleStep = (step: WorkflowStep): WorkflowStep => {
    if (step.agentId !== null && hiddenAgentIds.has(step.agentId))
      throw new HttpError(404, sourceText("error.workflow.stepMissing"));
    return memberStep(step);
  };

  switch (path) {
    case WORKFLOWS_ROUTES.list: {
      const known = listed();
      const all = await run(workflows.listWithGraphs());
      return json(200, {
        workflows: all.filter(({ graph }) => visibleGraph(graph, known)).map(({ summary }) => summary),
      });
    }
    case WORKFLOWS_ROUTES.get:
      return json(200, memberDetail(await visibleDetail(stringField(body, "workflowId"))));
    case WORKFLOWS_ROUTES.create: {
      const input = parse(parseCreateWorkflow, body);
      if (input.graph) requireChange({ nodes: [], edges: [], strokes: [] }, input.graph);
      return json(200, memberDetail(await run(workflows.create(input))));
    }
    case WORKFLOWS_ROUTES.rename: {
      const input = parse(parseRenameWorkflow, body);
      await usableDetail(input.workflowId, "manage");
      return json(200, await run(workflows.rename(input)));
    }
    case WORKFLOWS_ROUTES.delete: {
      const workflowId = stringField(body, "workflowId");
      await usableDetail(workflowId, "manage");
      await run(workflows.remove(workflowId));
      return json(200, {});
    }
    case WORKFLOWS_ROUTES.saveGraph: {
      const input = parse(parseSaveWorkflowGraph, body);
      const current = await visibleDetail(input.workflowId);
      requireChange(current.graph, input.graph);
      const result = await run(workflows.saveGraph(input));
      if (result.ok) return json(200, result);
      // Another device saved first. Its graph can name an agent that this member cannot see.
      if (!visibleGraph(result.conflict.graph, listed())) workflowMissing();
      return json(200, { ok: false, conflict: memberDetail(result.conflict) });
    }
    case WORKFLOWS_ROUTES.versions: {
      const workflowId = stringField(body, "workflowId");
      await visibleDetail(workflowId);
      return json(200, { versions: await run(workflows.versions(workflowId)) });
    }
    case WORKFLOWS_ROUTES.versionGraph: {
      const input = parse(parseWorkflowVersion, body);
      await visibleDetail(input.workflowId);
      const graph = await run(workflows.versionGraph(input));
      if (!visibleGraph(graph, listed())) throw new HttpError(404, sourceText("error.workflow.versionMissing"));
      return json(200, fitted({ graph }));
    }
    case WORKFLOWS_ROUTES.restoreVersion: {
      const input = parse(parseWorkflowVersion, body);
      const current = await visibleDetail(input.workflowId);
      requireChange(current.graph, await run(workflows.versionGraph(input)));
      return json(200, memberDetail(await run(workflows.restoreVersion(input))));
    }
    case WORKFLOWS_ROUTES.startRun: {
      const input = parse(parseStartWorkflowRun, body);
      await usableDetail(input.workflowId, "chat");
      return json(200, fittedRun(await run(workflows.startRun(input))));
    }
    case WORKFLOWS_ROUTES.runStep: {
      const input = parse(parseRunWorkflowStep, body);
      await usableDetail(input.workflowId, "chat");
      return json(200, soleStep(await run(workflows.runStep(input))));
    }
    case WORKFLOWS_ROUTES.stopStep: {
      const stepId = stringField(body, "stepId");
      await usableRunOf({ stepId });
      await run(workflows.stopStep(stepId));
      return json(200, {});
    }
    case WORKFLOWS_ROUTES.stopRun: {
      const runId = stringField(body, "runId");
      await usableRunOf({ runId });
      await run(workflows.stopRun(runId));
      return json(200, {});
    }
    case WORKFLOWS_ROUTES.retryStep: {
      const input = parse(parseRetryWorkflowStep, body);
      await usableRunOf({ stepId: input.stepId });
      return json(200, soleStep(await run(workflows.retryStep(input))));
    }
    case WORKFLOWS_ROUTES.decide: {
      const input = parse(parseDecideWorkflowStep, body);
      await usableRunOf({ stepId: input.stepId });
      await run(workflows.decide(input));
      return json(200, {});
    }
    case WORKFLOWS_ROUTES.runs: {
      const input = parse(parseWorkflowRuns, body);
      await visibleDetail(input.workflowId);
      return json(200, memberPage(await run(workflows.runs(input))));
    }
    case WORKFLOWS_ROUTES.run: {
      const runId = stringField(body, "runId");
      const workflowId = (await run(workflows.workflowOf({ runId })))?.workflowId;
      if (!workflowId) throw new HttpError(404, sourceText("error.workflow.runMissing"));
      // The answer filter drops the steps of agents hidden from the member.
      await visibleDetail(workflowId);
      return json(200, fittedRun(await run(workflows.run(runId))));
    }
    case WORKFLOWS_ROUTES.rotateWebhookSecret: {
      requireAdmin(member);
      const input = parse(parseWorkflowTrigger, body);
      await usableDetail(input.workflowId, "manage");
      return json(200, await runEventsEffect(workflows.rotateWorkflowSecret(input)));
    }
  }
  if (!github) return "unmatched";
  switch (path) {
    case WORKFLOWS_GITHUB_ROUTES.catalog:
      requireAdmin(member);
      return json(200, fitted(await run(github.catalog())));
    case WORKFLOWS_GITHUB_ROUTES.options: {
      requireAdmin(member);
      const input = parse(parseWorkflowGitHubRepository, body);
      return json(200, fitted(await run(github.options(input.repository))));
    }
    case WORKFLOWS_GITHUB_ROUTES.history: {
      const workflowId = stringField(body, "workflowId");
      await visibleDetail(workflowId);
      return json(200, fitted(await run(workflows.githubHistory(workflowId))));
    }
    case WORKFLOWS_GITHUB_ROUTES.runLastEvent: {
      const input = parse(parseWorkflowGitHubLastEvent, body);
      await usableDetail(input.workflowId, "chat");
      return json(200, fittedRun(await run(workflows.githubLastEvent(input))));
    }
  }
  return "unmatched";
}
