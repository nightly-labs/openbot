import {
  WORKFLOW_GROUP_FIELDS,
  WORKFLOW_MEDIA_CATALOG_V1_ASPECTS,
  WORKFLOW_STEP_NAME_FIELD,
  type WorkflowDetail,
  type WorkflowGraph,
  type WorkflowMediaCatalog,
  type WorkflowRunDetail,
  type WorkflowRunPage,
  type WorkflowStep,
  workflowNeedsAdmin,
} from "@openbot/contracts/ipc";
import {
  WORKFLOWS_CREDIT_MEDIA_CAPABILITY,
  WORKFLOWS_CREDIT_MEDIA_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-credit-media-v1";
import {
  WORKFLOWS_GITHUB_CAPABILITY,
  WORKFLOWS_GITHUB_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-github-v1";
import {
  WORKFLOWS_HIGGSFIELD_CAPABILITY,
  WORKFLOWS_HIGGSFIELD_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-higgsfield-v1";
import {
  WORKFLOWS_MEDIA_CATALOG_CAPABILITY,
  WORKFLOWS_MEDIA_CATALOG_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-media-catalog-v1";
import {
  WORKFLOWS_MEDIA_CATALOG_V2_CAPABILITY,
  WORKFLOWS_MEDIA_CATALOG_V2_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-media-catalog-v2";
import {
  WORKFLOWS_MEDIA_SERVICE_ACCOUNT_CAPABILITY,
  WORKFLOWS_MEDIA_SERVICE_ACCOUNT_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-media-service-account-v1";
import {
  WORKFLOWS_MEDIA_CAPABILITY,
  WORKFLOWS_MEDIA_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-media-v1";
import {
  WORKFLOWS_STEP_SETTINGS_CAPABILITY,
  WORKFLOWS_STEP_SETTINGS_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-step-settings-v1";
import {
  WORKFLOWS_SUNRA_CAPABILITY,
  WORKFLOWS_SUNRA_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-sunra-v1";
import {
  WORKFLOW_RUN_STEP_LIMIT,
  WORKFLOW_STEP_TEXT_LIMIT,
  WORKFLOWS_CAPABILITY,
  WORKFLOWS_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-v1";
import { sourceText } from "@openbot/i18n/source";
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
  parseWorkflowMediaPrice,
  parseWorkflowRuns,
  parseWorkflowTrigger,
  parseWorkflowVersion,
} from "../ipc/workflow-inputs";
import type { TeamApiAgents, TeamApiWorkflows } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, requireAgentLevel, stringField, WEBRTC_FRAME_BODY_BUDGET } from "./request-helpers";
import { runEventsEffect } from "./route-events";
import { runWorkflowEffect as run, workflowMissing, workflowVisibility } from "./workflow-visibility";

const WORKFLOW_PATHS = new Set<string>(Object.values(WORKFLOWS_ROUTES));
const WORKFLOW_GITHUB_PATHS = new Set<string>(Object.values(WORKFLOWS_GITHUB_ROUTES));
const WORKFLOW_MEDIA_PATHS = new Set<string>(Object.values(WORKFLOWS_MEDIA_ROUTES));
const WORKFLOW_SUNRA_PATHS = new Set<string>(Object.values(WORKFLOWS_SUNRA_ROUTES));
const WORKFLOW_HIGGSFIELD_PATHS = new Set<string>(Object.values(WORKFLOWS_HIGGSFIELD_ROUTES));
const WORKFLOW_MEDIA_CATALOG_PATHS = new Set<string>(Object.values(WORKFLOWS_MEDIA_CATALOG_ROUTES));
const WORKFLOW_MEDIA_CATALOG_V2_PATHS = new Set<string>(Object.values(WORKFLOWS_MEDIA_CATALOG_V2_ROUTES));
const WORKFLOW_MEDIA_ACCOUNT_PATHS = new Set<string>(Object.values(WORKFLOWS_MEDIA_SERVICE_ACCOUNT_ROUTES));
const WORKFLOW_CREDIT_MEDIA_PATHS = new Set<string>(Object.values(WORKFLOWS_CREDIT_MEDIA_ROUTES));
const WORKFLOW_STEP_SETTINGS_PATHS = new Set<string>(Object.values(WORKFLOWS_STEP_SETTINGS_ROUTES));

function serviceCatalog(catalog: WorkflowMediaCatalog): WorkflowMediaCatalog {
  return { models: catalog.models.filter((model) => model.provider !== "openbot") };
}

function catalogV1(catalog: WorkflowMediaCatalog): WorkflowMediaCatalog {
  return {
    models: serviceCatalog(catalog).models.flatMap(
      ({ options: _options, inputs: _inputs, modes: _modes, ...model }) => {
        const aspects = model.aspects.filter((aspect) => WORKFLOW_MEDIA_CATALOG_V1_ASPECTS.includes(aspect));
        return aspects.length > 0 ? [{ ...model, aspects }] : [];
      },
    ),
  };
}

function parse<A>(decode: (value: unknown) => A, body: unknown): A {
  try {
    return decode(body);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid workflow request.");
  }
}

function placeOutputs(graph: WorkflowGraph): Map<string, string> {
  const places = new Map<string, string>();
  for (const node of graph.nodes) {
    if (node.kind !== "output" || node.fields.target !== "channel") continue;
    places.set(node.id, JSON.stringify([node.fields.connectionId ?? null, node.fields.placeId ?? null]));
  }
  return places;
}

const DISPLAY_FIELD_KEYS: ReadonlySet<string> = new Set([
  ...Object.values(WORKFLOW_GROUP_FIELDS),
  WORKFLOW_STEP_NAME_FIELD,
]);

function adminNodes(graph: WorkflowGraph): Map<string, string> {
  const nodes = new Map<string, string>();
  for (const node of graph.nodes) {
    if (!workflowNeedsAdmin(node)) continue;
    const fields = Object.keys(node.fields)
      .filter((key) => !DISPLAY_FIELD_KEYS.has(key))
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

export async function routeWorkflows(
  context: TeamApiRequestContext,
  workflows: TeamApiWorkflows | undefined,
  agents: Pick<TeamApiAgents, "listAgents">,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const path = url.pathname;
  const githubPath = WORKFLOW_GITHUB_PATHS.has(path);
  const mediaPath = WORKFLOW_MEDIA_PATHS.has(path);
  const sunraPath = WORKFLOW_SUNRA_PATHS.has(path);
  const higgsfieldPath = WORKFLOW_HIGGSFIELD_PATHS.has(path);
  const catalogPath = WORKFLOW_MEDIA_CATALOG_PATHS.has(path);
  const catalogV2Path = WORKFLOW_MEDIA_CATALOG_V2_PATHS.has(path);
  const accountPath = WORKFLOW_MEDIA_ACCOUNT_PATHS.has(path);
  const creditPath = WORKFLOW_CREDIT_MEDIA_PATHS.has(path);
  const settingsPath = WORKFLOW_STEP_SETTINGS_PATHS.has(path);
  if (
    method !== "POST" ||
    !(
      githubPath ||
      mediaPath ||
      sunraPath ||
      higgsfieldPath ||
      catalogPath ||
      catalogV2Path ||
      accountPath ||
      creditPath ||
      settingsPath ||
      WORKFLOW_PATHS.has(path)
    )
  )
    return "unmatched";
  if (!workflows || !capabilities.has(WORKFLOWS_CAPABILITY))
    throw new HttpError(400, sourceText("error.workflow.serverTooOld"));
  const github = workflows.github;
  if (githubPath && (!github || !capabilities.has(WORKFLOWS_GITHUB_CAPABILITY)))
    throw new HttpError(400, sourceText("error.workflow.serverTooOld"));
  if (mediaPath && !capabilities.has(WORKFLOWS_MEDIA_CAPABILITY))
    throw new HttpError(400, sourceText("error.workflow.serverTooOld"));
  if (sunraPath && !capabilities.has(WORKFLOWS_SUNRA_CAPABILITY))
    throw new HttpError(400, sourceText("error.workflow.serverTooOld"));
  if (higgsfieldPath && !capabilities.has(WORKFLOWS_HIGGSFIELD_CAPABILITY))
    throw new HttpError(400, sourceText("error.workflow.serverTooOld"));
  if (catalogPath && !capabilities.has(WORKFLOWS_MEDIA_CATALOG_CAPABILITY))
    throw new HttpError(400, sourceText("error.workflow.serverTooOld"));
  if (catalogV2Path && !capabilities.has(WORKFLOWS_MEDIA_CATALOG_V2_CAPABILITY))
    throw new HttpError(400, sourceText("error.workflow.serverTooOld"));
  if (creditPath && !capabilities.has(WORKFLOWS_CREDIT_MEDIA_CAPABILITY))
    throw new HttpError(400, sourceText("error.workflow.serverTooOld"));
  if (accountPath && !capabilities.has(WORKFLOWS_MEDIA_SERVICE_ACCOUNT_CAPABILITY))
    throw new HttpError(400, sourceText("error.workflow.serverTooOld"));
  if (settingsPath && !capabilities.has(WORKFLOWS_STEP_SETTINGS_CAPABILITY))
    throw new HttpError(400, sourceText("error.workflow.serverTooOld"));
  const body = await readJson(request);
  const { admin, listed, visibleAgents, visibleGraph, requireUsable, visibleDetail, usableDetail } = workflowVisibility(
    context,
    workflows,
    agents,
    hiddenAgentIds,
  );
  const requireChange = (before: WorkflowGraph, after: WorkflowGraph) => {
    requireUsable(before, "manage");
    requireUsable(after, "manage");
    const old = placeOutputs(before);
    for (const [nodeId, place] of placeOutputs(after)) if (old.get(nodeId) !== place) requireAdmin(member);
    const oldAdmin = adminNodes(before);
    for (const [nodeId, settings] of adminNodes(after)) if (oldAdmin.get(nodeId) !== settings) requireAdmin(member);
  };
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
  const memberStep = (step: WorkflowStep): WorkflowStep => ({
    ...step,
    output: clip(step.output),
    error: clip(step.error),
  });
  const memberRun = (detail: WorkflowRunDetail): WorkflowRunDetail => ({
    run: { ...detail.run, error: clip(detail.run.error) },
    steps: detail.steps.slice(-WORKFLOW_RUN_STEP_LIMIT).map(memberStep),
  });
  const fittedRun = (detail: WorkflowRunDetail): WorkflowRunDetail => {
    const result = memberRun(detail);
    return trimmed(result, [result.steps]);
  };
  const memberPage = (page: WorkflowRunPage): WorkflowRunPage => {
    const result: WorkflowRunPage = {
      runs: page.runs.map(memberRun),
      soloSteps: page.soloSteps.map(memberStep),
      nextBefore: page.nextBefore,
    };
    return trimmed(result, [...result.runs.map((detail) => detail.steps).reverse(), result.soloSteps]);
  };
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
  if (path === WORKFLOWS_MEDIA_ROUTES.keepPicture) {
    return json(200, { fileId: await run(workflows.keepPicture(stringField(body, "draftId"))) });
  }
  if (path === WORKFLOWS_SUNRA_ROUTES.providers) return json(200, { sunra: workflows.mediaProviders().sunra });
  if (path === WORKFLOWS_SUNRA_ROUTES.credits)
    return json(200, { sunra: (await run(workflows.mediaCredits("sunra"))).sunra });
  if (path === WORKFLOWS_HIGGSFIELD_ROUTES.providers)
    return json(200, { higgsfield: workflows.mediaProviders().higgsfield });
  if (path === WORKFLOWS_HIGGSFIELD_ROUTES.credits)
    return json(200, { higgsfield: (await run(workflows.mediaCredits("higgsfield"))).higgsfield });
  if (path === WORKFLOWS_MEDIA_SERVICE_ACCOUNT_ROUTES.accounts)
    return json(200, { accounts: workflows.mediaProviders().accounts ?? [] });
  if (path === WORKFLOWS_MEDIA_SERVICE_ACCOUNT_ROUTES.credits)
    return json(200, { accounts: (await run(workflows.mediaCredits())).accounts ?? [] });
  if (path === WORKFLOWS_STEP_SETTINGS_ROUTES.read) {
    const stepId = stringField(body, "stepId");
    const scope = await run(workflows.workflowOf({ stepId }));
    if (scope === null) throw new HttpError(404, sourceText("error.workflow.stepMissing"));
    await visibleDetail(scope.workflowId);
    if (!visibleAgents(scope.agentIds, listed())) throw new HttpError(404, sourceText("error.workflow.stepMissing"));
    return json(200, fitted(await run(workflows.stepSettings(stepId))));
  }
  if (path === WORKFLOWS_MEDIA_CATALOG_ROUTES.catalog) return json(200, catalogV1(await run(workflows.mediaCatalog())));
  if (path === WORKFLOWS_MEDIA_CATALOG_V2_ROUTES.catalog)
    return json(200, serviceCatalog(await run(workflows.mediaCatalog())));
  if (path === WORKFLOWS_CREDIT_MEDIA_ROUTES.catalog) return json(200, await run(workflows.mediaCatalog("openbot")));
  if (path === WORKFLOWS_CREDIT_MEDIA_ROUTES.credits)
    return json(200, { openbot: (await run(workflows.mediaCredits("openbot"))).openbot ?? null });
  if (path === WORKFLOWS_MEDIA_CATALOG_ROUTES.price || path === WORKFLOWS_MEDIA_CATALOG_V2_ROUTES.price)
    return json(200, await run(workflows.mediaPrice(parse(parseWorkflowMediaPrice, body))));
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
