import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  WORKFLOW_FORMAT,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowRunDetail,
  workflowAnswerProblems,
  workflowGraphFormat,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import type { WorkflowGitHubApi, WorkflowGitHubChange } from "../src/backend/workflows/workflow-github-api";
import { WorkflowGitHubStore } from "../src/backend/workflows/workflow-github-store";
import { WorkflowRunStore } from "../src/backend/workflows/workflow-run-store";
import { WorkflowStore } from "../src/backend/workflows/workflow-store";
import { handleWorkflowTool } from "../src/backend/workflows/workflow-tools";
import { workflowScheduleDueAt } from "../src/backend/workflows/workflow-triggers";
import { createWorkflows, type WorkflowNotice, type WorkflowsHandle } from "../src/backend/workflows/workflows";

const OUT = resolve(import.meta.dirname, "../.openbot-build/workflow-output-templates-e2e");
const WAIT_MS = 5_000;
const REPOSITORY = "acme/app";
const ANSWER = "priority: high|normal|low\nsummary: text\ntags: list\nowner: text";
const REPLY = '{"priority":"high","summary":"Login fails","tags":["bug","auth"],"owner":"ana"}';

interface Report {
  checks: string[];
  notices: WorkflowNotice[];
  changes: WorkflowGitHubChange[];
  formats: Record<string, number>;
  passed: boolean;
  failure?: string;
}

const report: Report = { checks: [], notices: [], changes: [], formats: {}, passed: false };
const check = (name: string, ok: boolean, detail?: unknown) => {
  assert.ok(ok, `${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  report.checks.push(name);
};

const node = (id: string, kind: WorkflowNode["kind"], x: number, fields: WorkflowNode["fields"]): WorkflowNode => ({
  id,
  kind,
  at: { x, y: 0 },
  fields,
});

const typedGraph = (outputs: readonly WorkflowNode[], replyNode = true): WorkflowGraph => ({
  nodes: [
    node("prompt", "prompt", 0, { text: "Ticket: users cannot log in." }),
    ...(replyNode ? [node("model", "llm", 300, { prompt: "Sort this ticket.", answer: ANSWER })] : []),
    ...outputs,
  ],
  edges: [
    ...(replyNode ? [{ id: "prompt-model", from: "prompt", to: "model", type: "text" as const }] : []),
    ...outputs.map((output) => ({
      id: `${replyNode ? "model" : "prompt"}-${output.id}`,
      from: replyNode ? "model" : "prompt",
      to: output.id,
      type: "text" as const,
    })),
  ],
  strokes: [],
});

const directory = await mkdtemp(join(tmpdir(), "openbot-workflow-output-templates-"));
const database = new OpenBotDatabase(directory);
let service: WorkflowsHandle | null = null;
let modelReplies: string[] = [];

const githubApi: WorkflowGitHubApi = {
  attachFiles: (change) => Effect.succeed({ ...change, files: null }),
  change: (change) =>
    Effect.sync(() => {
      report.changes.push(change);
      return {
        created:
          change.action === "issue.create" ? { kind: "issue" as const, number: 40 + report.changes.length } : null,
        url: null,
      };
    }),
  options: () => Effect.succeed({ labels: [{ name: "bug", color: "d73a4a" }], people: ["ana"] }),
  recentEvents: () => Effect.succeed([]),
};

async function runUntil(runId: string, until: (detail: WorkflowRunDetail) => boolean): Promise<WorkflowRunDetail> {
  assert.ok(service);
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    await Effect.runPromise(service.sweep());
    const detail = await runCauseEffect(service.run(runId));
    if (until(detail)) return detail;
    if (Date.now() > deadline) throw new Error(`The run did not reach the state: ${JSON.stringify(detail)}`);
    await new Promise((done) => setImmediate(done));
  }
}
const ended = (detail: WorkflowRunDetail) => detail.run.status !== "running" && detail.run.status !== "stopping";
const stepOf = (detail: WorkflowRunDetail, nodeId: string) =>
  detail.steps.filter((step) => step.nodeId === nodeId).sort((a, b) => b.attempt - a.attempt)[0];

async function saved(title: string, graph: WorkflowGraph) {
  assert.ok(service);
  const created = await runCauseEffect(service.create({ title }));
  const result = await runCauseEffect(
    service.saveGraph({ workflowId: created.summary.id, baseRevision: created.revision, graph }),
  );
  assert.ok(result.ok, JSON.stringify(result));
  return created.summary.id;
}

async function startRun(title: string, graph: WorkflowGraph) {
  assert.ok(service);
  const workflowId = await saved(title, graph);
  const started = await runCauseEffect(service.startRun({ workflowId, requestId: crypto.randomUUID() }));
  return runUntil(started.run.id, ended);
}

try {
  await Effect.runPromise(database.initialize());
  service = await Effect.runPromise(
    createWorkflows({
      store: new WorkflowStore({ database, nextDueAt: workflowScheduleDueAt(() => "UTC") }),
      runs: new WorkflowRunStore({ database }),
      github: new WorkflowGitHubStore({ database }),
      githubApp: () => null,
      githubApi,
      delivery: () => null,
      turnAnswer: () => null,
      sendHandoff: () => Effect.fail({ cause: new Error("No agent step runs in this test.") }),
      stopDelivery: () => Effect.void,
      generateText: () => Effect.succeed(modelReplies.shift() ?? ""),
      notify: (notice) => report.notices.push(notice),
      connectionOn: () => false,
      post: () => Effect.die(new Error("No channel output runs in this test.")),
      changed: () => {},
      rearm: () => {},
      timezone: () => "UTC",
    }),
  );
  const workflows = service;

  const plain = typedGraph([node("tell", "output", 600, { target: "notify", title: "Ticket" })]);
  const message = typedGraph([node("tell", "output", 600, { target: "notify", message: "Ticket" })]);
  const titled = typedGraph([node("tell", "output", 600, { target: "notify", title: "{{priority}} ticket" })]);
  report.formats = {
    plain: workflowGraphFormat(plain),
    message: workflowGraphFormat(message),
    titled: workflowGraphFormat(titled),
  };
  check(
    "an output with a message or a {{name}} in title, labels or person needs format 2; plain fields stay format 1",
    WORKFLOW_FORMAT >= 2 && report.formats.plain === 1 && report.formats.message === 2 && report.formats.titled === 2,
    report.formats,
  );
  const messageId = await saved("Format of a saved graph", message);
  const detail = await runCauseEffect(workflows.get(messageId));
  check(
    "the host says the saved format and its own format",
    detail.format === 2 && detail.hostFormat === WORKFLOW_FORMAT,
    { format: detail.format, hostFormat: detail.hostFormat },
  );

  modelReplies = [REPLY];
  const notified = await startRun(
    "Notify with a message",
    typedGraph([
      node("tell", "output", 600, {
        target: "notify",
        title: "{{priority}}: {{summary}}",
        message: "{{summary}} ({{priority}}), tags {{tags}}, owner {{owner}}.",
      }),
    ]),
  );
  const notice = report.notices.at(-1);
  check(
    "the output sends its message with the names filled as plain text, in place of the input",
    stepOf(notified, "tell")?.status === "done" && notice?.text === "Login fails (high), tags bug, auth, owner ana.",
    { step: stepOf(notified, "tell"), notice },
  );
  check(
    "a notification uses the output title with the names filled",
    notice?.workflowTitle === "high: Login fails",
    notice,
  );

  modelReplies = [REPLY];
  const before = report.notices.length;
  const input = await startRun("Notify the input", typedGraph([node("tell", "output", 600, { target: "notify" })]));
  check(
    "an output with no message still sends its input, under the workflow title",
    stepOf(input, "tell")?.status === "done" &&
      report.notices.length === before + 1 &&
      report.notices.at(-1)?.text.includes("Login fails") === true &&
      report.notices.at(-1)?.workflowTitle === "Notify the input",
    report.notices.at(-1),
  );

  modelReplies = [REPLY];
  const github = await startRun(
    "GitHub with names",
    typedGraph([
      node("issue", "output", 600, {
        target: "github",
        repository: REPOSITORY,
        action: "issue.create",
        title: "[{{priority}}] {{summary}}",
        labels: "{{tags}}\nfrom-workflow",
        message: "Reported: {{summary}}",
      }),
      node("assign", "output", 600, {
        target: "github",
        repository: REPOSITORY,
        action: "assign",
        item: "input",
        person: "{{owner}}",
        message: "#12",
      }),
    ]),
  );
  const created = report.changes.find((change) => change.action === "issue.create");
  const assigned = report.changes.find((change) => change.action === "assign");
  check(
    "a GitHub issue gets the filled title, the message as its body, and each item of a list as a label",
    stepOf(github, "issue")?.status === "done" &&
      created?.title === "[high] Login fails" &&
      created.body === "Reported: Login fails" &&
      JSON.stringify(created.labels) === JSON.stringify(["bug", "auth", "from-workflow"]),
    { step: stepOf(github, "issue"), created },
  );
  check(
    "a GitHub person comes from a field, and the item number from the message",
    stepOf(github, "assign")?.status === "done" &&
      JSON.stringify(assigned?.people) === JSON.stringify(["ana"]) &&
      assigned?.number === 12,
    { step: stepOf(github, "assign"), assigned },
  );

  const missing = typedGraph([node("tell", "output", 600, { target: "notify", message: "Owner: {{assignee}}" })]);
  check(
    "the editor shows a problem for an output name that no step before gives",
    workflowAnswerProblems(missing).some(
      (problem) => problem.code === "template" && problem.name === "assignee" && problem.field === "message",
    ),
    workflowAnswerProblems(missing),
  );
  modelReplies = [REPLY];
  const failed = await startRun("Unknown name", missing);
  check(
    "an output name that no step gives fails the step and sends nothing",
    stepOf(failed, "tell")?.status === "failed" &&
      stepOf(failed, "tell")?.error === sourceText("error.workflow.answerSetup", { fields: "assignee" }) &&
      !report.notices.some((sent) => sent.text.includes("{{assignee}}")),
    stepOf(failed, "tell"),
  );

  const untyped = await startRun(
    "No typed step",
    typedGraph([node("tell", "output", 600, { target: "notify", title: "Hi {{there}}" })], false),
  );
  check(
    "with no typed step before it, a {{name}} stays as written, as in released versions",
    stepOf(untyped, "tell")?.status === "done" && report.notices.at(-1)?.workflowTitle === "Hi {{there}}",
    report.notices.at(-1),
  );

  const builder = await runCauseEffect(
    handleWorkflowTool(
      "edit_workflow",
      {
        title: "Built by an agent",
        ops: [
          { op: "add", ref: "prompt", kind: "prompt", fields: { text: "Ticket" } },
          { op: "add", ref: "model", kind: "llm", from: "prompt", fields: { prompt: "Sort it.", answer: ANSWER } },
          {
            op: "add",
            ref: "tell",
            kind: "output",
            from: "model",
            fields: { target: "notify", message: "{{summary}} for {{owner}}" },
          },
        ],
      },
      workflows,
      "agent-builder",
      `call-${crypto.randomUUID()}`,
      new Set<string>(),
      undefined,
      () => Effect.succeed(false),
    ),
  );
  const builtText = builder?.contentItems[0]?.type === "inputText" ? builder.contentItems[0].text : "";
  const builtId = builder?.success === true ? String(JSON.parse(builtText).workflowId ?? "") : "";
  const built = builtId ? await runCauseEffect(workflows.get(builtId)) : null;
  check(
    "an agent can make an output with a message that uses earlier fields, and the host saves it as format 2",
    built?.graph.nodes.some((item) => item.kind === "output" && item.fields.message === "{{summary}} for {{owner}}") ===
      true && built.format === 2,
    builtText,
  );

  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  try {
    if (service) await Effect.runPromise(service.close());
    database.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  mkdirSync(OUT, { recursive: true });
  const artifact = join(OUT, "report.json");
  writeFileSync(artifact, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${artifact}\n`);
  if (report.failure) process.stderr.write(`${report.failure}\n`);
}
