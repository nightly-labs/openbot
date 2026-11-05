// Checks the `openbot` workflow tools that agents use, on the real SQLite and the real workflow
// service, on a temporary profile. Each call goes through `tool_search` and the `tool_call`
// envelope as an agent sends it. Only the agent mailbox is a stand-in that keeps each delivery
// running, so no provider, app, account or network is started.
//
// It builds a workflow with refs in one call (trigger, agent, condition, output), moves, changes and
// removes nodes, reads it back, runs it and reads the run, and checks the failures that the model must
// correct: an edge that a rule refuses, an unknown agent and a locked node. The report keeps the byte
// size of each tool result, so the context cost is visible. It also checks that a search says to run
// the tools with tool_call, that tool_call accepts the name as `tool`, that each delete asks the
// user and a decline keeps the workflow, and that the change event names the agent that built it.
//
// Run: bun scripts/workflow-agent-tools-e2e.ts
// Writes .openbot-build/workflow-agent-tools-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { z } from "zod";
import { discoverTools, resolveDeferredTool } from "../src/backend/agent/tool-catalog";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import type { DynamicToolCallParams } from "../src/backend/protocol";
import { WorkflowGitHubStore } from "../src/backend/workflows/workflow-github-store";
import { WorkflowRunStore } from "../src/backend/workflows/workflow-run-store";
import { WorkflowStore } from "../src/backend/workflows/workflow-store";
import { handleWorkflowTool } from "../src/backend/workflows/workflow-tools";
import { workflowScheduleDueAt } from "../src/backend/workflows/workflow-triggers";
import { createWorkflows, type WorkflowsHandle } from "../src/backend/workflows/workflows";

const OUT = resolve(import.meta.dirname, "../.openbot-build/workflow-agent-tools-e2e");
const WAIT_MS = 5_000;
const AGENTS = new Set(["agent-research"]);
/** The agent that calls the tools. */
const CALLER = "agent-builder";

// Decoders of the tool results that the checks read.
const created = z.object({ workflowId: z.string(), ids: z.record(z.string(), z.string()) });
const workflowRead = z.object({
  title: z.string(),
  nodes: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      fields: z.record(z.string(), z.unknown()),
      at: z.unknown().optional(),
    }),
  ),
  edges: z.array(
    z.object({ from: z.string(), to: z.string(), branch: z.string().optional(), type: z.string().optional() }),
  ),
});
const point = z.object({ x: z.number(), y: z.number() });
const laidOut = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      at: point,
      size: z.object({ width: z.number(), height: z.number() }),
    }),
  ),
  edges: z.array(z.object({ from: z.string(), to: z.string() })),
});
const runStarted = z.object({ runId: z.string() });
const runRead = z.object({
  steps: z.array(
    z.object({ nodeId: z.string(), status: z.string(), kind: z.string().optional(), label: z.string().optional() }),
  ),
});

interface Report {
  checks: string[];
  /** Bytes of each tool result that the agent reads. */
  bytes: Record<string, number>;
  /** Each change event, as `workflowId` or `workflowId by agentId`. */
  changed: string[];
  passed: boolean;
  failure?: string;
}

const report: Report = { checks: [], bytes: {}, changed: [], passed: false };
const check = (name: string, ok: boolean, detail?: unknown) => {
  assert.ok(ok, `${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  report.checks.push(name);
};

const params = (tool: string, args: unknown): DynamicToolCallParams => ({
  threadId: "thread-e2e",
  turnId: "turn-e2e",
  callId: crypto.randomUUID(),
  namespace: "openbot",
  tool,
  arguments: args,
});

const directory = await mkdtemp(join(tmpdir(), "openbot-workflow-agent-tools-"));
const database = new OpenBotDatabase(directory);
let workflows: WorkflowsHandle | null = null;

/** The titles that a delete asked the user about, and the user's next answer. */
const deleteAsked: string[] = [];
let deleteAnswer = true;
const confirmDelete = (title: string) =>
  Effect.sync(() => {
    deleteAsked.push(title);
    return deleteAnswer;
  });

/** The room that a connection and its port chips need between two columns, and the space between two rows. */
const COLUMN_GAP = 120;
const ROW_GAP = 64;

/**
 * Reads the workflow with its layout, and gives each place where it does not look clean: a connection
 * that goes left or has no room to show, or two cards nearer than the gaps.
 */
async function layoutProblems(label: string, workflowId: string) {
  const graph = laidOut.parse((await call(label, "read_workflow", { workflowId, layout: true })).value);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const problems: string[] = [];
  for (const edge of graph.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (from && to && to.at.x < from.at.x + from.size.width + COLUMN_GAP)
      problems.push(`no room for ${from.kind} > ${to.kind}`);
  }
  graph.nodes.forEach((a, index) => {
    for (const b of graph.nodes.slice(index + 1)) {
      const apart =
        a.at.x + a.size.width + COLUMN_GAP <= b.at.x ||
        b.at.x + b.size.width + COLUMN_GAP <= a.at.x ||
        a.at.y + a.size.height + ROW_GAP <= b.at.y ||
        b.at.y + b.size.height + ROW_GAP <= a.at.y;
      if (!apart) problems.push(`${a.kind} crowds ${b.kind}`);
    }
  });
  return { problems, nodes: byId };
}

let calls = 0;

/** Calls a workflow tool as an agent does: through the `tool_call` envelope. The same `callKey` is a repeated call. */
async function call(
  label: string,
  name: string,
  args: unknown,
  callKey = `call-${++calls}`,
): Promise<{ ok: boolean; value: unknown }> {
  assert.ok(workflows);
  const resolved = resolveDeferredTool(params("tool_call", { name: `openbot.${name}`, arguments: args }));
  assert.ok(resolved, `tool_call refused openbot.${name}`);
  const response = await runCauseEffect(
    handleWorkflowTool(resolved.tool, resolved.arguments, workflows, CALLER, callKey, AGENTS, confirmDelete),
  );
  assert.ok(response, `no handler for ${name}`);
  const item = response.contentItems[0];
  assert.ok(item && item.type === "inputText");
  report.bytes[label] = Buffer.byteLength(item.text);
  return { ok: response.success, value: JSON.parse(item.text) };
}

try {
  await Effect.runPromise(database.initialize());
  workflows = await Effect.runPromise(
    createWorkflows({
      store: new WorkflowStore({ database, nextDueAt: workflowScheduleDueAt(() => "UTC") }),
      runs: new WorkflowRunStore({ database }),
      github: new WorkflowGitHubStore({ database }),
      githubApp: () => null,
      // Each delivery stays running, so the run waits on the agent step.
      delivery: () => ({ status: "running", turnId: null, error: null }),
      turnAnswer: () => null,
      sendHandoff: () => Effect.succeed(`delivery-${crypto.randomUUID()}`),
      stopDelivery: () => Effect.void,
      generateText: () => Effect.fail({ message: "No model step runs in this test." }),
      notify: () => {},
      connectionOn: () => false,
      post: () => Effect.die(new Error("No output step runs in this test.")),
      changed: (workflowId, agentId) => report.changed.push(agentId ? `${workflowId} by ${agentId}` : workflowId),
      rearm: () => {},
      timezone: () => "UTC",
    }),
  );

  // 1. Search finds the tools with their schemas and guidance.
  // The query names no tool in full, as a model's first search often does. It also names a routine,
  // as a model that reads "every morning" does, but only the workflow tools come with schemas.
  const search = discoverTools(params("tool_search", { query: "create workflow routine with approval" }));
  report.bytes.search = Buffer.byteLength(JSON.stringify(search));
  const ready = search.tools.filter((tool) => "inputSchema" in tool).map((tool) => tool.name);
  check(
    "a workflow search gives all 6 workflow tools with schemas, and the guidance",
    ready.filter((name) => name.includes("workflow")).length === 6 &&
      (search.guidance ?? []).some((text) => text.includes("Fields by kind")),
    search,
  );
  check(
    "a workflow search loads no other schema or guidance",
    ready.every((name) => name.includes("workflow")) &&
      !(search.guidance ?? []).some((text) => text.includes("Manage scheduled work")),
    { ready, guidance: search.guidance },
  );
  const mixed = discoverTools(params("tool_search", { queries: ["workflow", "openbot_browser.snapshot"] }));
  check(
    "a workflow search keeps the schema of a tool that another query names exactly",
    mixed.tools.some((tool) => tool.name === "openbot_browser.snapshot" && "inputSchema" in tool),
    mixed.tools.map((tool) => tool.name),
  );
  // Claude called a found tool directly, and then sent its name as `tool`. Each refusal cost a model step.
  check(
    "a workflow search says to run the tools with tool_call, and has no browser note",
    search.call?.includes("tool_call") === true && !("note" in search),
    search,
  );
  const alias = resolveDeferredTool(params("tool_call", { tool: "openbot.list_workflows", arguments: {} }));
  check("tool_call accepts the qualified name as tool", alias?.tool === "list_workflows", alias);

  // 2. One call builds a workflow with refs.
  const built = await call("create", "edit_workflow", {
    title: "Morning news",
    ops: [
      { op: "add", ref: "start", kind: "trigger", fields: { trigger: "manual" } },
      {
        op: "add",
        ref: "news",
        kind: "agent",
        from: "start",
        fields: { agentId: "agent-research", task: "Find the news." },
      },
      { op: "add", ref: "check", kind: "condition", from: "news", fields: { rule: "Is there news?" } },
      // The "no" child comes first, as a model can send it; the layout still puts "yes" above it.
      { op: "add", ref: "quiet", kind: "output", from: "check", branch: "no", fields: { title: "No news" } },
      { op: "add", ref: "tell", kind: "output", from: "check", branch: "yes" },
      { op: "add", ref: "label", kind: "note", fields: { text: "Built by an agent" } },
    ],
  });
  check("edit_workflow creates the workflow", built.ok, built.value);
  const { workflowId, ids } = created.parse(built.value);
  check("the result gives an id for each ref", Object.keys(ids).length === 6, ids);
  check(
    "the create, with its graph, is one change that names the agent that built it",
    report.changed.filter((change) => change === `${workflowId} by ${CALLER}`).length === 1,
    report.changed,
  );

  const read = await call("read", "read_workflow", { workflowId });
  const graph = workflowRead.parse(read.value);
  check("read_workflow has the 6 nodes and 4 edges", graph.nodes.length === 6 && graph.edges.length === 4, graph);
  check(
    "the output gets the notify target, and the condition edge its branch",
    graph.nodes.some((node) => node.id === ids.tell && node.fields.target === "notify") &&
      graph.edges.some((edge) => edge.from === ids.check && edge.to === ids.tell && edge.branch === "yes"),
    graph,
  );
  check(
    "a read without layout has no positions",
    graph.nodes.every((node) => node.at === undefined),
    graph,
  );

  const stored = await runCauseEffect(workflows.get(workflowId));
  const at = (id: string | undefined) => stored.graph.nodes.find((node) => node.id === id)?.at;
  const start = at(ids.start);
  const news = at(ids.news);
  check(
    "automatic layout puts a step right of the node before it",
    start !== undefined && news !== undefined && news.x > start.x && news.y === start.y,
    { start, news },
  );
  const points = stored.graph.nodes.map((node) => `${node.at.x},${node.at.y}`);
  check("no two nodes share a position", new Set(points).size === points.length, points);
  const fresh = await layoutProblems("read-layout-new", workflowId);
  check("a new workflow has room for each connection, and no card crowds another", fresh.problems.length === 0, fresh);
  const yes = fresh.nodes.get(ids.tell ?? "");
  const no = fresh.nodes.get(ids.quiet ?? "");
  check(
    "a condition's yes child is beside it and its no child is below the yes child",
    yes !== undefined &&
      no !== undefined &&
      yes.at.y === fresh.nodes.get(ids.check ?? "")?.at.y &&
      no.at.x === yes.at.x &&
      no.at.y >= yes.at.y + yes.size.height + ROW_GAP,
    { yes, no },
  );

  // 3. Move, change and remove.
  const edited = await call("edit", "edit_workflow", {
    workflowId,
    title: "Morning news digest",
    ops: [
      { op: "move", node: ids.label, at: { x: 0, y: -400 } },
      { op: "update", node: ids.news, fields: { task: "Find three news items." } },
      { op: "remove", node: ids.label },
    ],
  });
  check("edit_workflow moves, changes and removes", edited.ok, edited.value);
  const after = await call("read-layout", "read_workflow", { workflowId, layout: true });
  const afterGraph = workflowRead.parse(after.value);
  check(
    "the rename, the new task and the removal are saved",
    afterGraph.title === "Morning news digest" &&
      afterGraph.nodes.length === 5 &&
      afterGraph.nodes.some((node) => node.fields.task === "Find three news items."),
    afterGraph,
  );
  check(
    "a read with layout has positions",
    afterGraph.nodes.every((node) => node.at !== undefined),
    afterGraph,
  );

  // 4. A step put between two nodes moves the later nodes one column right.
  const before = await runCauseEffect(workflows.get(workflowId));
  const was = (id: string | undefined) => before.graph.nodes.find((node) => node.id === id)?.at;
  const inserted = await call("insert", "edit_workflow", {
    workflowId,
    ops: [
      { op: "disconnect", from: ids.news, to: ids.check },
      { op: "add", ref: "gate", kind: "approval", from: ids.news, fields: { question: "Go on?" } },
      { op: "connect", from: "gate", to: ids.check },
    ],
  });
  check("edit_workflow puts a step between two nodes", inserted.ok, inserted.value);
  const gateId = created.parse(inserted.value).ids.gate;
  const moved = await runCauseEffect(workflows.get(workflowId));
  const now = (id: string | undefined) => moved.graph.nodes.find((node) => node.id === id)?.at;
  const layout = {
    news: now(ids.news),
    gate: now(gateId),
    check: now(ids.check),
    tell: now(ids.tell),
    checkBefore: was(ids.check),
    tellBefore: was(ids.tell),
  };
  check(
    "the inserted step takes the old column, and the later steps move right by its column",
    layout.news !== undefined &&
      layout.gate?.x === layout.news.x + 350 + COLUMN_GAP &&
      layout.gate.y === layout.news.y &&
      layout.check?.x === (layout.checkBefore?.x ?? 0) + 300 + COLUMN_GAP &&
      layout.tell?.x === (layout.tellBefore?.x ?? 0) + 300 + COLUMN_GAP,
    layout,
  );
  const afterInsert = await layoutProblems("read-layout-insert", workflowId);
  check(
    "after the insert, each connection has room and no card crowds another",
    afterInsert.problems.length === 0,
    afterInsert,
  );

  // 4b. tidy lays out a graph that the agent made untidy.
  const messy = await call("mess", "edit_workflow", {
    workflowId,
    ops: [
      { op: "move", node: gateId, at: { x: 40, y: 30 } },
      { op: "move", node: ids.tell, at: { x: -500, y: 600 } },
    ],
  });
  check(
    "move ops put cards on top of each other",
    messy.ok && (await layoutProblems("read-layout-mess", workflowId)).problems.length > 0,
    messy.value,
  );
  const tidied = await call("tidy", "edit_workflow", { workflowId, tidy: true });
  const tidy = await layoutProblems("read-layout-tidy", workflowId);
  check("tidy lays the graph out again with room for each connection", tidied.ok && tidy.problems.length === 0, tidy);

  // 5. Failures that the model corrects.
  const badEdge = await call("failure-edge", "edit_workflow", {
    workflowId,
    ops: [{ op: "connect", from: ids.news, to: ids.tell, branch: "no" }],
  });
  check(
    "a branch edge from an agent is refused with the reason",
    !badEdge.ok && JSON.stringify(badEdge.value).includes("only an edge from a condition"),
    badEdge.value,
  );
  const badAgent = await call("failure-agent", "edit_workflow", {
    workflowId,
    ops: [{ op: "update", node: ids.news, fields: { agentId: "agent-gone" } }],
  });
  check(
    "an unknown agent is refused",
    !badAgent.ok && JSON.stringify(badAgent.value).includes("agent-gone"),
    badAgent.value,
  );
  const lockedDetail = await runCauseEffect(workflows.get(workflowId));
  const saved = await runCauseEffect(
    workflows.saveGraph({
      workflowId,
      baseRevision: lockedDetail.revision,
      graph: {
        ...lockedDetail.graph,
        nodes: lockedDetail.graph.nodes.map((node) => (node.id === ids.start ? { ...node, locked: true } : node)),
      },
    }),
  );
  assert.ok(saved.ok);
  const locked = await call("failure-locked", "edit_workflow", {
    workflowId,
    title: "Renamed by mistake",
    ops: [{ op: "move", node: ids.start, at: { x: 900, y: 900 } }],
  });
  check("a locked node does not move", !locked.ok && JSON.stringify(locked.value).includes("locked"), locked.value);
  const unchanged = await runCauseEffect(workflows.get(workflowId));
  check(
    "a refused edit saves nothing, also not its rename",
    unchanged.revision === saved.revision && unchanged.summary.title === "Morning news digest",
    unchanged.summary,
  );
  const libraryBefore = (await runCauseEffect(workflows.list())).length;
  const badNew = await call("failure-new", "edit_workflow", {
    title: "Broken",
    ops: [
      { op: "add", ref: "go", kind: "trigger" },
      { op: "remove", node: "missing" },
    ],
  });
  const libraryAfter = (await runCauseEffect(workflows.list())).length;
  check("a refused new workflow is not made", !badNew.ok && libraryAfter === libraryBefore, {
    result: badNew.value,
    libraryBefore,
    libraryAfter,
  });

  // 6. Run and read the run.
  const run = await call("run", "run_workflow", { workflowId }, "run-call");
  check("run_workflow starts a run", run.ok, run.value);
  const { runId } = runStarted.parse(run.value);
  const repeated = await call("run-repeated", "run_workflow", { workflowId }, "run-call");
  check(
    "a repeated run_workflow call starts no second run",
    repeated.ok && runStarted.parse(repeated.value).runId === runId,
    repeated.value,
  );
  const deadline = Date.now() + WAIT_MS;
  let runs = await call("runs", "read_workflow_runs", { workflowId, runId });
  const agentRunning = () =>
    runRead.parse(runs.value).steps.some((step) => step.nodeId === ids.news && step.status === "running");
  while (!agentRunning()) {
    if (Date.now() > deadline) throw new Error(`The agent step did not start: ${JSON.stringify(runs.value)}`);
    await new Promise((done) => setImmediate(done));
    runs = await call("runs", "read_workflow_runs", { workflowId, runId });
  }
  check("read_workflow_runs shows the agent step running", runs.ok, runs.value);
  check(
    "each step of a run read gives its kind and label",
    runRead
      .parse(runs.value)
      .steps.some((step) => step.nodeId === ids.news && step.kind === "agent" && step.label === "agent-research"),
    runs.value,
  );
  const list = await call("list", "list_workflows", {});
  check(
    "list_workflows shows the workflow with its last run",
    list.ok &&
      JSON.stringify(list.value).includes("Morning news digest") &&
      JSON.stringify(list.value).includes("lastRun"),
    list.value,
  );

  const scheduled = await call("schedule", "edit_workflow", {
    workflowId,
    ops: [{ op: "update", node: ids.start, schedule: { kind: "daily", time: "08:00" } }],
  });
  const trigger = (await runCauseEffect(workflows.get(workflowId))).graph.nodes.find((node) => node.id === ids.start);
  check(
    "a schedule on a manual trigger makes it a schedule trigger",
    scheduled.ok && trigger?.fields.trigger === "schedule" && JSON.stringify(trigger.schedule).includes("08:00"),
    trigger,
  );

  // 7. Delete: each one asks the user, and a decline keeps the workflow.
  deleteAnswer = false;
  const declined = await call("failure-delete-declined", "delete_workflow", { workflowId });
  const kept = await call("read-after-decline", "read_workflow", { workflowId });
  check(
    "a declined delete_workflow is a tool failure and keeps the workflow",
    !declined.ok && JSON.stringify(declined.value).includes("declined") && kept.ok && deleteAsked.length === 1,
    declined.value,
  );
  deleteAnswer = true;
  const removed = await call("delete", "delete_workflow", { workflowId });
  check("delete_workflow removes it after the approval", removed.ok && deleteAsked.length === 2, removed.value);
  const gone = await call("failure-missing", "read_workflow", { workflowId });
  check("a deleted workflow reads as a tool failure", !gone.ok, gone.value);

  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  if (workflows) await Effect.runPromise(workflows.close()).catch(() => {});
  database.close();
  await rm(directory, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${report.passed ? "passed" : "FAILED"}: ${report.checks.length} checks; ${OUT}/report.json\n`);
  if (report.failure) process.stderr.write(`${report.failure}\n`);
  process.exitCode = report.passed ? 0 : 1;
}
