// The workflow group of the preview: workflows, graphs, versions and runs in memory, and a fixed
// GitHub connection. A save checks the revision as the host does; the graph rules stay the host's. A
// run walks the graph as the host does: each step ends after `STEP_MS` with a fixed answer, a
// condition answers yes, an approval waits for `decide`, and a node with the field `mockFail` fails.

import {
  isGitHubRepositoryName,
  isWorkflowStepKind,
  nodeAgentId,
  type OpenBotDesktopApi,
  type StartWorkflowRunInput,
  WORKFLOW_AUTO_VERSION_INTERVAL_MS,
  WORKFLOW_MAX_VERSIONS,
  type WorkflowDetail,
  type WorkflowGitHubCatalog,
  type WorkflowGitHubDelivery,
  type WorkflowGitHubItem,
  type WorkflowGitHubRepositoryOptions,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowRun,
  type WorkflowRunDetail,
  type WorkflowRunSource,
  type WorkflowStep,
  type WorkflowSummary,
  type WorkflowTriggerState,
  type WorkflowVersion,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { nextValidRoutineOccurrence } from "@openbot/team-client/routine-schedule";

const PREVIEW_HOOKS = "https://hooks.openbot.run/wf";

/** The GitHub connection of the preview: two repositories, and the bot cannot change the second one. */
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

/** An issue of the repository that a GitHub trigger watches, or of the first preview repository. */
function previewItem(node: WorkflowNode, number: number, title: string): WorkflowGitHubItem {
  const repository = node.fields.repository;
  return {
    repository: isGitHubRepositoryName(repository) ? repository : "openbot-preview/app",
    number,
    pullRequest: false,
    title,
  };
}

/** The next time of a schedule trigger, in its zone. A schedule without a next time, such as a past once, has none. */
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

/** A workflow that a story starts with. */
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

/** The fixed answer of a step in the preview. */
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

/** `emit` sends the agent event `workflows-changed` for one workflow that changed. */
export function mockWorkflows(
  seeds: readonly MockWorkflowSeed[],
  emit: (workflowId: string) => void,
): OpenBotDesktopApi["workflows"] {
  const records = new Map<string, MockWorkflowRecord>();
  const stamp = () => new Date().toISOString();
  /** The webhook triggers that have a secret, as `<workflowId>/<nodeId>`. The host makes a route only then. */
  const webhooks = new Set<string>();
  /** The triggers that the host stores: a message trigger does not run in v1, so it has no state. */
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
  const summaryOf = (id: string, title: string, graph: WorkflowGraph, updatedAt: string): WorkflowSummary => ({
    id,
    title,
    steps: graph.nodes.filter((node) => isWorkflowStepKind(node.kind)).length,
    updatedAt,
    lastRun: null,
  });
  const put = (id: string, title: string, graph: WorkflowGraph, revision: number, updatedAt = stamp()) => {
    const versions = records.get(id)?.versions ?? [];
    const detail: WorkflowDetail = {
      summary: summaryOf(id, title, graph, updatedAt),
      graph: structuredClone(graph),
      revision,
      triggers: triggersOf(id, graph),
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

  const runs = new Map<string, { run: WorkflowRun; graph: WorkflowGraph; scope: Set<string> }>();
  const steps = new Map<string, WorkflowStep>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** The input of each step. A retry and an approval hand it on, as the host does. */
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
  const addStep = (workflowId: string, runId: string | null, node: WorkflowNode, input: string) => {
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
        else end(step, { status: "done", output: mockAnswer(node, input) });
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
  /** Starts each node whose nodes before it ended, then sets the run's status. */
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
            const skipped = addStep(run.workflowId, runId, node, "");
            clearTimeout(timers.get(skipped.id));
            end(skipped, { status: "skipped" });
            started = true;
          }
          continue;
        }
        addStep(run.workflowId, runId, node, inputs.join("\n\n"));
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
  /** The nodes after `origin`, and `origin` itself. */
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
  /** Starts a run from `fromNodeId`, or of the whole workflow. A repeat of one request gives the same run. */
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
  /** The GitHub trigger `nodeId` of a workflow, or the same failure as the host's. */
  const githubTriggerOf = (workflowId: string, nodeId: string) => {
    const node = nodeOf(workflowId, nodeId);
    if (node.kind !== "trigger" || node.fields.trigger !== "github")
      throw new Error(sourceText("error.workflow.nodeMissing"));
    return node;
  };

  return {
    list: async () =>
      structuredClone([...records.values()].map((entry) => entry.detail.summary)).sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      ),
    get: async (workflowId) => structuredClone(record(workflowId).detail),
    create: async (input) => {
      const id = crypto.randomUUID();
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
      const step = addStep(input.workflowId, null, node, "");
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
      const step = addStep(failed.workflowId, failed.runId, node, stepInputs.get(failed.id) ?? "");
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
        // A rejection stops the whole run.
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
    // The preview has no relay: the address takes no request, and the secret is only for the dialog.
    rotateWebhookSecret: async (input) => {
      const { detail } = record(input.workflowId);
      webhooks.add(`${input.workflowId}/${input.nodeId}`);
      detail.triggers = triggersOf(input.workflowId, detail.graph);
      emit(input.workflowId);
      return { secret: `whsec_preview_${crypto.randomUUID()}` };
    },
    githubCatalog: async () => structuredClone(PREVIEW_GITHUB_CATALOG),
    githubOptions: async (input) => {
      if (!PREVIEW_GITHUB_CATALOG.repositories.some((repository) => repository.fullName === input.repository))
        throw new Error(sourceText("error.workflow.githubNoAccess"));
      return structuredClone(PREVIEW_GITHUB_OPTIONS);
    },
    // Two events of each GitHub trigger: one that started a run of the preview, and one that a filter skipped.
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
    // The preview has no GitHub: the newest matching item is a fixed one, and the run starts at once.
    githubRunLastEvent: async (input) => {
      githubTriggerOf(input.workflowId, input.nodeId);
      return beginRun({ workflowId: input.workflowId, requestId: input.requestId, fromNodeId: input.nodeId }, "github");
    },
  };
}
