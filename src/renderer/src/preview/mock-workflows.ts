import {
  applyWorkflowFolderAction,
  EMPTY_WORKFLOW_FOLDERS,
  isWorkflowStepKind,
  nodeAgentId,
  type OpenBotDesktopApi,
  prunedWorkflowFolders,
  type StartWorkflowRunInput,
  WORKFLOW_AUTO_VERSION_INTERVAL_MS,
  WORKFLOW_FORMAT,
  WORKFLOW_MAX_VERSIONS,
  WORKFLOW_MEDIA_MODELS,
  type WorkflowDetail,
  type WorkflowFoldersSnapshot,
  type WorkflowGitHubCatalog,
  type WorkflowGitHubDelivery,
  type WorkflowGitHubItem,
  type WorkflowGitHubRepositoryOptions,
  type WorkflowGraph,
  type WorkflowMediaAccountCredits,
  type WorkflowMediaCatalogModel,
  type WorkflowMediaOptionValue,
  type WorkflowNode,
  type WorkflowRun,
  type WorkflowRunDetail,
  type WorkflowRunSource,
  type WorkflowStep,
  type WorkflowStepSettings,
  type WorkflowSummary,
  type WorkflowTriggerState,
  type WorkflowVersion,
  workflowCatalogProvider,
  workflowFixedCatalogModel,
  workflowGitHubTriggerRepositories,
  workflowGraphFormat,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { nextValidRoutineOccurrence } from "@openbot/team-client/routine-schedule";
import { workflowMediaCreditsOf, workflowMediaProvidersOf } from "@openbot/team-client/workflow-decoding";

const PREVIEW_HOOKS = "https://hooks.openbot.run/wf";

const PREVIEW_GITHUB_CATALOG: WorkflowGitHubCatalog = {
  connected: true,
  repositories: [
    { fullName: "openbot-preview/app", private: false, canWrite: true, events: true },
    { fullName: "openbot-preview/docs", private: true, canWrite: false, events: true },
  ],
};

const PREVIEW_GITHUB_OPTIONS: WorkflowGitHubRepositoryOptions = {
  labels: [
    { name: "bug", color: "d73a4a" },
    { name: "enhancement", color: "a2eeef" },
    { name: "needs triage", color: "fbca04" },
  ],
  people: ["octocat", "hubot"],
};

function previewItem(node: WorkflowNode, number: number, title: string): WorkflowGitHubItem {
  const repositories = workflowGitHubTriggerRepositories(node.fields);
  return {
    repository: repositories[number % Math.max(repositories.length, 1)] ?? "openbot-preview/app",
    number,
    pullRequest: false,
    title,
  };
}

function nextDue(node: WorkflowNode): string | null {
  if (!node.schedule) return null;
  const zone = typeof node.fields.timezone === "string" && node.fields.timezone ? node.fields.timezone : undefined;
  try {
    return nextValidRoutineOccurrence(
      node.schedule,
      zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      new Date(),
    ).toISOString();
  } catch {
    return null;
  }
}

export interface MockWorkflowSeed {
  id: string;
  title: string;
  graph: WorkflowGraph;
  updatedAt?: string;
}

interface MockWorkflowRecord {
  detail: WorkflowDetail;
  versions: (WorkflowVersion & { graph: WorkflowGraph })[];
}

const STEP_MS = 900;
const OPEN_STEPS: readonly WorkflowStep["status"][] = ["running", "approval"];

function mockAnswer(node: WorkflowNode, input: string): string {
  switch (node.kind) {
    case "trigger":
      return "";
    case "prompt":
      return typeof node.fields.text === "string" ? node.fields.text : "";
    case "agent":
      return "I checked the three competitor pages. Two changed their pricing this week.";
    case "llm":
      return "Summary: two competitors raised their prices by about 10%.";
    default:
      return input;
  }
}

const PREVIEW_VIDEO_OPTIONS: Pick<WorkflowMediaCatalogModel, "aspects" | "options" | "inputs"> = {
  aspects: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
  options: [{ name: "generate_audio", kind: "switch", values: ["off", "on"], default: "on" }],
  inputs: ["frames", "references"],
};

const previewSeconds = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

const PREVIEW_SEEDANCE: Pick<WorkflowMediaCatalogModel, "durations" | "resolutions" | "options" | "inputs"> = {
  durations: previewSeconds(4, 15),
  resolutions: ["480p", "720p", "1080p", "4K"],
  options: [
    { name: "mode", kind: "choice", values: ["std", "fast"], default: "std" },
    {
      name: "genre",
      kind: "choice",
      values: ["auto", "action", "horror", "comedy", "noir", "drama", "epic"],
      default: "auto",
    },
    { name: "generate_audio", kind: "switch", values: ["off", "on"], default: "on" },
  ],
  inputs: ["frames", "references", "videos", "audios"],
};

const PREVIEW_KLING: Pick<WorkflowMediaCatalogModel, "aspects" | "durations" | "options" | "inputs" | "modes"> = {
  aspects: ["1:1", "16:9", "9:16", "21:9"],
  durations: previewSeconds(3, 30),
  options: [
    {
      name: "mode",
      kind: "choice",
      values: ["text-to-video", "image-to-video", "reference-to-video"],
      default: "text-to-video",
    },
  ],
  inputs: ["frames", "references", "videos"],
  modes: [
    { value: "text-to-video", inputs: [] },
    { value: "image-to-video", inputs: ["frames"] },
    { value: "reference-to-video", inputs: ["references", "videos"] },
  ],
};

const PREVIEW_LIVE_MODELS: Readonly<
  Record<
    string,
    Partial<Pick<WorkflowMediaCatalogModel, "aspects" | "durations" | "resolutions" | "options" | "inputs" | "modes">>
  >
> = {
  "higgsfield-seedance_2_0": PREVIEW_SEEDANCE,
  "higgsfield-kling4_0": PREVIEW_KLING,
};

const PREVIEW_MEDIA_CATALOG: WorkflowMediaCatalogModel[] = WORKFLOW_MEDIA_MODELS.flatMap((model) => {
  if (model.provider === "higgsfield") {
    const entry = workflowFixedCatalogModel(model, model.provider);
    if (!model.kinds.includes("video")) return [entry];
    return [{ ...entry, ...PREVIEW_VIDEO_OPTIONS, ...PREVIEW_LIVE_MODELS[model.id] }];
  }
  if (model.provider !== "sunra") return [];
  const entry = workflowFixedCatalogModel(model, model.provider);
  return [{ ...entry, resolutions: entry.resolutions.map((value) => value.replace(/K$/u, "k")) }];
});

function previewQuote(
  kind: "image" | "video",
  duration: number,
  resolution: string | null,
  options?: readonly WorkflowMediaOptionValue[],
): number {
  const scale = resolution?.startsWith("4") || resolution === "1080p" ? 2 : 1;
  const sound = options?.some((option) => option.name === "generate_audio" && option.value === "off") ? 1 : 1.5;
  return (kind === "video" ? duration * 2.5 * sound : 1.5) * scale;
}

const PREVIEW_MEDIA_ACCOUNTS: readonly WorkflowMediaAccountCredits[] = [
  { provider: "sunra", id: "preview-sunra", name: null, credits: { available: 1240, quota: 2000 } },
  { provider: "higgsfield", id: "preview-higgsfield", name: null, credits: { available: 860, quota: null } },
  { provider: "higgsfield", id: "preview-higgsfield-2", name: "Higgsfield 2", credits: { available: 95, quota: null } },
];

export function mockWorkflows(
  seeds: readonly MockWorkflowSeed[],
  emit: (workflowId: string) => void,
  emitFolders: () => void = () => undefined,
): OpenBotDesktopApi["workflows"] {
  const records = new Map<string, MockWorkflowRecord>();
  const stamp = () => new Date().toISOString();
  const webhooks = new Set<string>();
  const triggersOf = (id: string, graph: WorkflowGraph): WorkflowTriggerState[] =>
    graph.nodes.flatMap((node): WorkflowTriggerState[] => {
      if (node.kind !== "trigger") return [];
      const type = node.fields.trigger ?? "manual";
      if (type !== "manual" && type !== "schedule" && type !== "webhook") return [];
      return [
        {
          nodeId: node.id,
          type,
          nextDueAt: type === "schedule" && node.schedule ? nextDue(node) : null,
          webhookUrl: type === "webhook" && webhooks.has(`${id}/${node.id}`) ? `${PREVIEW_HOOKS}/${node.id}` : null,
        },
      ];
    });
  const pausedIds = new Set<string>();
  const summaryOf = (id: string, title: string, graph: WorkflowGraph, updatedAt: string): WorkflowSummary => ({
    id,
    title,
    steps: graph.nodes.filter((node) => isWorkflowStepKind(node.kind)).length,
    updatedAt,
    lastRun: null,
    ...(pausedIds.has(id) ? { paused: true } : {}),
  });
  const put = (id: string, title: string, graph: WorkflowGraph, revision: number, updatedAt = stamp()) => {
    const versions = records.get(id)?.versions ?? [];
    const detail: WorkflowDetail = {
      summary: summaryOf(id, title, graph, updatedAt),
      graph: structuredClone(graph),
      revision,
      triggers: triggersOf(id, graph),
      format: workflowGraphFormat(graph),
      hostFormat: WORKFLOW_FORMAT,
    };
    records.set(id, { detail, versions });
    return detail;
  };
  const record = (id: string) => {
    const found = records.get(id);
    if (!found) throw new Error(sourceText("error.workflow.missing"));
    return found;
  };
  const addVersion = (id: string, kind: WorkflowVersion["kind"]) => {
    const { detail, versions } = record(id);
    versions.unshift({ id: crypto.randomUUID(), at: stamp(), kind, revision: detail.revision, graph: detail.graph });
    versions.splice(WORKFLOW_MAX_VERSIONS);
  };
  for (const seed of seeds) put(seed.id, seed.title, seed.graph, 0, seed.updatedAt);

  const accounts = structuredClone(PREVIEW_MEDIA_ACCOUNTS);
  const spend = (node: WorkflowNode) => {
    const provider = typeof node.fields.model === "string" ? workflowCatalogProvider(node.fields.model) : null;
    if (node.kind !== "image" || !provider) return;
    const chosen =
      typeof node.fields.account === "string" && node.fields.account !== "default" ? node.fields.account : "";
    const balance = accounts.find(
      (account) => account.provider === provider && (chosen === "" || account.id === chosen),
    )?.credits;
    if (!balance) return;
    const kind = node.fields.media === "video" ? "video" : "image";
    const duration = typeof node.fields.duration === "number" ? node.fields.duration : 5;
    const resolution = typeof node.fields.resolution === "string" ? node.fields.resolution : null;
    balance.available = Math.max(0, balance.available - previewQuote(kind, duration, resolution));
  };
  const runs = new Map<string, { run: WorkflowRun; graph: WorkflowGraph; scope: Set<string> }>();
  const steps = new Map<string, WorkflowStep>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const stepInputs = new Map<string, string>();
  const runSteps = (runId: string) => [...steps.values()].filter((step) => step.runId === runId);
  const latestOf = (runId: string) => {
    const latest = new Map<string, WorkflowStep>();
    for (const step of runSteps(runId)) {
      const current = latest.get(step.nodeId);
      if (!current || step.attempt >= current.attempt) latest.set(step.nodeId, step);
    }
    return latest;
  };
  const runDetail = (runId: string): WorkflowRunDetail => {
    const entry = runs.get(runId);
    if (!entry) throw new Error(sourceText("error.workflow.runMissing"));
    return structuredClone({ run: entry.run, steps: runSteps(runId) });
  };
  const touchSummary = (workflowId: string, run: WorkflowRun) => {
    const found = records.get(workflowId);
    if (found) found.detail.summary.lastRun = { status: run.status, at: run.startedAt };
  };
  const end = (step: WorkflowStep, patch: Partial<WorkflowStep>) => {
    timers.delete(step.id);
    Object.assign(step, { endedAt: stamp(), ...patch });
  };
  const recorded = new Map<string, WorkflowStepSettings>();
  const doneSteps = (workflowId: string) => {
    const latest = new Map<string, WorkflowStep>();
    for (const step of steps.values())
      if (step.workflowId === workflowId && step.status === "done") latest.set(step.nodeId, step);
    return latest;
  };
  const recordOf = (
    graph: WorkflowGraph,
    node: WorkflowNode,
    latest: ReadonlyMap<string, WorkflowStep>,
  ): WorkflowStepSettings => ({
    settings: Object.fromEntries(Object.entries(node.fields).filter(([name]) => name !== "label")),
    sources: graph.edges
      .filter((edge) => edge.to === node.id)
      .map((edge) => {
        const from = graph.nodes.find((candidate) => candidate.id === edge.from);
        const fileId = from?.kind === "asset" && typeof from.fields.fileId === "string" ? from.fields.fileId : null;
        return { from: edge.from, type: edge.type, stepId: latest.get(edge.from)?.id ?? null, attachmentId: fileId };
      })
      .filter((source) => source.stepId !== null || source.attachmentId !== null),
  });
  const addStep = (
    workflowId: string,
    runId: string | null,
    node: WorkflowNode,
    input: string,
    settings: WorkflowStepSettings,
  ) => {
    const attempt = [...steps.values()].filter((step) => step.runId === runId && step.nodeId === node.id).length + 1;
    const step: WorkflowStep = {
      id: crypto.randomUUID(),
      workflowId,
      runId,
      nodeId: node.id,
      attempt,
      agentId: nodeAgentId(node),
      status: "running",
      output: null,
      branch: null,
      error: null,
      startedAt: stamp(),
      endedAt: null,
    };
    steps.set(step.id, step);
    stepInputs.set(step.id, input);
    recorded.set(step.id, settings);
    if (node.kind === "approval") {
      step.status = "approval";
      return step;
    }
    timers.set(
      step.id,
      setTimeout(() => {
        if (step.status !== "running") return;
        if (node.fields.mockFail === true)
          end(step, { status: "failed", error: sourceText("error.workflow.modelFailed") });
        else if (node.kind === "condition") end(step, { status: "done", output: input, branch: "yes" });
        else {
          end(step, { status: "done", output: mockAnswer(node, input) });
          spend(node);
        }
        if (runId) advance(runId);
        emit(workflowId);
      }, STEP_MS),
    );
    return step;
  };
  const inputsOf = (graph: WorkflowGraph, nodeId: string, latest: ReadonlyMap<string, WorkflowStep>) =>
    graph.edges
      .filter((edge) => edge.to === nodeId)
      .flatMap((edge) => {
        const source = latest.get(edge.from);
        const active = source?.status === "done" && (source.branch === null || edge.branch === source.branch);
        return active ? [source.output ?? ""] : [];
      });
  const advance = (runId: string) => {
    const entry = runs.get(runId);
    if (!entry) return;
    const { run, graph, scope } = entry;
    for (;;) {
      const latest = latestOf(runId);
      let started = false;
      for (const node of graph.nodes) {
        if (!scope.has(node.id) || run.status === "stopping") continue;
        const current = latest.get(node.id);
        if (current && current.status !== "skipped") continue;
        const before = graph.edges.filter((edge) => edge.to === node.id && scope.has(edge.from));
        if (
          before.some((edge) => {
            const source = latest.get(edge.from);
            return !source || OPEN_STEPS.includes(source.status);
          })
        )
          continue;
        const inputs = inputsOf(graph, node.id, latest);
        if (before.length > 0 && inputs.length === 0) {
          if (!current) {
            const skipped = addStep(run.workflowId, runId, node, "", recordOf(graph, node, latest));
            clearTimeout(timers.get(skipped.id));
            end(skipped, { status: "skipped" });
            started = true;
          }
          continue;
        }
        addStep(run.workflowId, runId, node, inputs.join("\n\n"), recordOf(graph, node, latest));
        started = true;
      }
      if (!started) break;
    }
    const ends = [...latestOf(runId).values()];
    const open = ends.filter((step) => OPEN_STEPS.includes(step.status));
    run.status =
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
    if (open.length === 0) run.endedAt = stamp();
    touchSummary(run.workflowId, run);
  };
  const stopStep = (step: WorkflowStep) => {
    if (!OPEN_STEPS.includes(step.status)) return;
    clearTimeout(timers.get(step.id));
    end(step, { status: "stopped" });
  };
  const nodeOf = (workflowId: string, nodeId: string) => {
    const node = record(workflowId).detail.graph.nodes.find((entry) => entry.id === nodeId);
    if (!node) throw new Error(sourceText("error.workflow.nodeMissing"));
    return node;
  };
  const stepOf = (stepId: string) => {
    const step = steps.get(stepId);
    if (!step) throw new Error(sourceText("error.workflow.stepMissing"));
    return step;
  };
  const reach = (graph: WorkflowGraph, origin: string) => {
    const seen = new Set([origin]);
    const pending = [origin];
    for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
      for (const edge of graph.edges) {
        if (edge.from !== id || seen.has(edge.to)) continue;
        seen.add(edge.to);
        pending.push(edge.to);
      }
    }
    return seen;
  };
  const runRequests = new Map<string, string>();
  const beginRun = (input: StartWorkflowRunInput, source: WorkflowRunSource) => {
    const known = runRequests.get(input.requestId);
    if (known) return runDetail(known);
    const { detail } = record(input.workflowId);
    const graph = structuredClone(detail.graph);
    const stepNodes = graph.nodes.filter((node) => isWorkflowStepKind(node.kind)).map((node) => node.id);
    const from = input.fromNodeId;
    if (from !== undefined && !stepNodes.includes(from)) throw new Error(sourceText("error.workflow.nodeMissing"));
    const scope = from === undefined ? new Set(stepNodes) : reach(graph, from);
    const number = [...runs.values()].filter((entry) => entry.run.workflowId === input.workflowId).length + 1;
    const triggerNodeId =
      from !== undefined && graph.nodes.find((node) => node.id === from)?.kind === "trigger" ? from : null;
    const run: WorkflowRun = {
      id: crypto.randomUUID(),
      workflowId: input.workflowId,
      number,
      triggerNodeId,
      source,
      status: "running",
      error: null,
      startedAt: stamp(),
      endedAt: null,
    };
    runs.set(run.id, { run, graph, scope });
    runRequests.set(input.requestId, run.id);
    addVersion(input.workflowId, "run");
    advance(run.id);
    emit(input.workflowId);
    return runDetail(run.id);
  };
  const githubTriggerOf = (workflowId: string, nodeId: string) => {
    const node = nodeOf(workflowId, nodeId);
    if (node.kind !== "trigger" || node.fields.trigger !== "github")
      throw new Error(sourceText("error.workflow.nodeMissing"));
    return node;
  };

  let folders: WorkflowFoldersSnapshot = structuredClone(EMPTY_WORKFLOW_FOLDERS);
  const currentFolders = () => prunedWorkflowFolders(folders, new Set(records.keys()));
  return {
    folders: async () => structuredClone(currentFolders()),
    folderAction: async (action) => {
      const current = currentFolders();
      const next = applyWorkflowFolderAction(current, action, { workflowIds: new Set(records.keys()) });
      folders = next;
      if (next !== current) emitFolders();
      return structuredClone(next);
    },
    list: async () =>
      structuredClone([...records.values()].map((entry) => entry.detail.summary)).sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      ),
    get: async (workflowId) => structuredClone(record(workflowId).detail),
    create: async (input) => {
      const id = crypto.randomUUID();
      if (input.paused) pausedIds.add(id);
      const detail = put(id, input.title.trim(), input.graph ?? { nodes: [], edges: [], strokes: [] }, 0);
      emit(id);
      return structuredClone(detail);
    },
    rename: async (input) => {
      const { detail } = record(input.workflowId);
      const next = put(input.workflowId, input.title.trim(), detail.graph, detail.revision);
      emit(input.workflowId);
      return structuredClone(next.summary);
    },
    setPaused: async (input) => {
      const { detail } = record(input.workflowId);
      if (input.paused) pausedIds.add(input.workflowId);
      else pausedIds.delete(input.workflowId);
      const next = put(input.workflowId, detail.summary.title, detail.graph, detail.revision);
      emit(input.workflowId);
      return structuredClone(next.summary);
    },
    exportFile: async (workflowId) => {
      record(workflowId);
      return { saved: false, problem: null };
    },
    delete: async (workflowId) => {
      for (const step of steps.values()) if (step.workflowId === workflowId) stopStep(step);
      if (records.delete(workflowId)) emit(workflowId);
    },
    saveGraph: async (input) => {
      const { detail, versions } = record(input.workflowId);
      if (detail.revision !== input.baseRevision) return { ok: false, conflict: structuredClone(detail) };
      put(input.workflowId, detail.summary.title, input.graph, detail.revision + 1);
      const last = versions[0];
      if (!last || Date.now() - Date.parse(last.at) >= WORKFLOW_AUTO_VERSION_INTERVAL_MS)
        addVersion(input.workflowId, "auto");
      emit(input.workflowId);
      return { ok: true, revision: detail.revision + 1 };
    },
    versions: async (workflowId) =>
      structuredClone(record(workflowId).versions.map(({ graph: _graph, ...version }) => version)),
    versionGraph: async (input) => {
      const version = record(input.workflowId).versions.find((entry) => entry.id === input.versionId);
      if (!version) throw new Error(sourceText("error.workflow.versionMissing"));
      return structuredClone(version.graph);
    },
    restoreVersion: async (input) => {
      const { detail, versions } = record(input.workflowId);
      const version = versions.find((entry) => entry.id === input.versionId);
      if (!version) throw new Error(sourceText("error.workflow.versionMissing"));
      addVersion(input.workflowId, "restore");
      const next = put(input.workflowId, detail.summary.title, version.graph, detail.revision + 1);
      emit(input.workflowId);
      return structuredClone(next);
    },
    startRun: async (input) => beginRun(input, "manual"),
    runStep: async (input) => {
      const node = nodeOf(input.workflowId, input.nodeId);
      const graph = record(input.workflowId).detail.graph;
      const step = addStep(input.workflowId, null, node, "", recordOf(graph, node, doneSteps(input.workflowId)));
      emit(input.workflowId);
      return structuredClone(step);
    },
    stopStep: async (stepId) => {
      const step = stepOf(stepId);
      stopStep(step);
      if (step.runId) advance(step.runId);
      emit(step.workflowId);
    },
    stopRun: async (runId) => {
      const entry = runs.get(runId);
      if (!entry) throw new Error(sourceText("error.workflow.runMissing"));
      entry.run.status = "stopping";
      for (const step of runSteps(runId)) stopStep(step);
      advance(runId);
      emit(entry.run.workflowId);
    },
    retryStep: async (input) => {
      const failed = stepOf(input.stepId);
      if (failed.status !== "failed" && failed.status !== "stopped")
        throw new Error(sourceText("error.workflow.notRetryable"));
      const entry = failed.runId ? runs.get(failed.runId) : undefined;
      const node =
        entry?.graph.nodes.find((candidate) => candidate.id === failed.nodeId) ??
        nodeOf(failed.workflowId, failed.nodeId);
      if (entry) {
        entry.run.status = "running";
        entry.run.endedAt = null;
      }
      const graph = entry?.graph ?? record(failed.workflowId).detail.graph;
      const latest = entry ? latestOf(entry.run.id) : doneSteps(failed.workflowId);
      const step = addStep(
        failed.workflowId,
        failed.runId,
        node,
        stepInputs.get(failed.id) ?? "",
        recordOf(graph, node, latest),
      );
      if (entry) advance(entry.run.id);
      emit(failed.workflowId);
      return structuredClone(step);
    },
    decide: async (input) => {
      const step = stepOf(input.stepId);
      if (step.status !== "approval") throw new Error(sourceText("error.workflow.noDecision"));
      const entry = step.runId ? runs.get(step.runId) : undefined;
      if (input.approved) {
        end(step, { status: "done", output: stepInputs.get(step.id) ?? "" });
      } else {
        end(step, { status: "stopped" });
        if (entry) {
          entry.run.status = "stopping";
          for (const other of runSteps(entry.run.id)) stopStep(other);
        }
      }
      if (entry) advance(entry.run.id);
      emit(step.workflowId);
    },
    runs: async (input) => {
      record(input.workflowId);
      const all = [...runs.values()]
        .map((entry) => entry.run)
        .filter((run) => run.workflowId === input.workflowId && (!input.before || run.startedAt < input.before))
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
      const page = all.slice(0, input.limit);
      return {
        runs: page.map((run) => runDetail(run.id)),
        soloSteps: input.before
          ? []
          : structuredClone(
              [...steps.values()].filter((step) => step.workflowId === input.workflowId && step.runId === null),
            ),
        nextBefore: all.length > page.length ? (page.at(-1)?.startedAt ?? null) : null,
      };
    },
    run: async (runId) => runDetail(runId),
    stepSettings: async (stepId) =>
      structuredClone(recorded.get(stepOf(stepId).id) ?? { settings: null, sources: null }),
    rotateWebhookSecret: async (input) => {
      const { detail } = record(input.workflowId);
      webhooks.add(`${input.workflowId}/${input.nodeId}`);
      detail.triggers = triggersOf(input.workflowId, detail.graph);
      emit(input.workflowId);
      return { secret: `whsec_preview_${crypto.randomUUID()}` };
    },
    keepPicture: async (draftId) => draftId,
    mediaProviders: async () =>
      workflowMediaProvidersOf(accounts.map(({ provider, id, name }) => ({ provider, id, name }))),
    mediaCredits: async () => workflowMediaCreditsOf(structuredClone(accounts)),
    mediaCatalog: async () => ({ models: PREVIEW_MEDIA_CATALOG }),
    mediaPrice: async (input) => ({
      credits: previewQuote(input.kind, input.duration, input.resolution, input.options),
    }),
    githubCatalog: async () => structuredClone(PREVIEW_GITHUB_CATALOG),
    githubOptions: async (input) => {
      if (!PREVIEW_GITHUB_CATALOG.repositories.some((repository) => repository.fullName === input.repository))
        throw new Error(sourceText("error.workflow.githubNoAccess"));
      return structuredClone(PREVIEW_GITHUB_OPTIONS);
    },
    githubHistory: async (workflowId) => {
      const { detail } = record(workflowId);
      const triggers = detail.graph.nodes.filter((node) => node.kind === "trigger" && node.fields.trigger === "github");
      const started = [...runs.values()]
        .map((entry) => entry.run)
        .filter((run) => run.workflowId === workflowId && run.source === "github");
      const now = Date.now();
      return {
        deliveries: triggers.flatMap((node, index): WorkflowGitHubDelivery[] => [
          {
            id: `${node.id}-opened`,
            nodeId: node.id,
            event: "issue.opened",
            item: previewItem(node, 42, "Crash when the export folder is missing"),
            receivedAt: new Date(now - (index * 2 + 1) * 60_000).toISOString(),
            outcome: "started",
            reason: null,
            runId: started[0]?.id ?? null,
          },
          {
            id: `${node.id}-skipped`,
            nodeId: node.id,
            event: "issue.opened",
            item: previewItem(node, 41, "Add a dark theme to the settings"),
            receivedAt: new Date(now - (index * 2 + 2) * 60_000).toISOString(),
            outcome: "skipped",
            reason: "filter",
            runId: null,
          },
        ]),
        runs: started.flatMap((run) => {
          const node = triggers.find((trigger) => trigger.id === run.triggerNodeId);
          return node
            ? [{ runId: run.id, item: previewItem(node, 42, "Crash when the export folder is missing") }]
            : [];
        }),
      };
    },
    githubRunLastEvent: async (input) => {
      githubTriggerOf(input.workflowId, input.nodeId);
      return beginRun({ workflowId: input.workflowId, requestId: input.requestId, fromNodeId: input.nodeId }, "github");
    },
  };
}
