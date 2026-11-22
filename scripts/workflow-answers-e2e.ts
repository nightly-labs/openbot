import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { lastJsonObject, type WorkflowGraph, type WorkflowNode, type WorkflowRunDetail } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { WorkflowGitHubStore } from "../src/backend/workflows/workflow-github-store";
import { WorkflowRunStore } from "../src/backend/workflows/workflow-run-store";
import { WorkflowStore } from "../src/backend/workflows/workflow-store";
import { handleWorkflowTool } from "../src/backend/workflows/workflow-tools";
import { workflowScheduleDueAt } from "../src/backend/workflows/workflow-triggers";
import { createWorkflows, type WorkflowsHandle } from "../src/backend/workflows/workflows";

const OUT = resolve(import.meta.dirname, "../.openbot-build/workflow-answers-e2e");
const WAIT_MS = 5_000;
const AGENT = "agent-support";
const TRIAGE = "priority: high|normal|low\ncount: number";
const REPORT = "summary: text\ndone: yes/no";

type DeliveryState = { status: "running" | "completed"; turnId: string | null; error: string | null };

interface Report {
  checks: string[];
  modelPrompts: string[];
  handoffs: { deliveryId: string; text: string; idempotencyKey: string }[];
  notices: string[];
  promptBytes: Record<string, number>;
  passed: boolean;
  failure?: string;
}

const report: Report = { checks: [], modelPrompts: [], handoffs: [], notices: [], promptBytes: {}, passed: false };
const check = (name: string, ok: boolean, detail?: unknown) => {
  assert.ok(ok, `${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  report.checks.push(name);
};

const deliveries = new Map<string, DeliveryState>();
const turnAnswers = new Map<string, string>();
let modelReplies: string[] = [];
const MODEL_TIMEOUT = "The model did not answer in time.";
let failModelCall = 0;
let failFixHandoff = false;

const node = (id: string, kind: WorkflowNode["kind"], x: number, fields: WorkflowNode["fields"]): WorkflowNode => ({
  id,
  kind,
  at: { x, y: 0 },
  fields,
});

const triageGraph = (check: string, agentAnswer: string): WorkflowGraph => ({
  nodes: [
    node("prompt", "prompt", 0, { text: "Ticket: the app does not start for three users." }),
    node("model", "llm", 300, { prompt: "Rate this ticket.", answer: TRIAGE }),
    node("gate", "condition", 600, { check }),
    node("agent", "agent", 900, {
      agentId: AGENT,
      task: "Handle the {{priority}} ticket for {{count}} users.",
      answer: agentAnswer,
    }),
    node("quiet", "output", 900, { target: "notify" }),
    node("tell", "output", 1200, { target: "notify" }),
  ],
  edges: [
    { id: "prompt-model", from: "prompt", to: "model", type: "text" },
    { id: "model-gate", from: "model", to: "gate", type: "text" },
    { id: "gate-agent", from: "gate", to: "agent", type: "text", branch: "yes" },
    { id: "gate-quiet", from: "gate", to: "quiet", type: "text", branch: "no" },
    { id: "agent-tell", from: "agent", to: "tell", type: "text" },
  ],
  strokes: [],
});

const directory = await mkdtemp(join(tmpdir(), "openbot-workflow-answers-"));
const database = new OpenBotDatabase(directory);
let service: WorkflowsHandle | null = null;

async function runUntil(
  workflows: WorkflowsHandle,
  runId: string,
  until: (detail: WorkflowRunDetail) => boolean,
): Promise<WorkflowRunDetail> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    await Effect.runPromise(workflows.sweep());
    const detail = await runCauseEffect(workflows.run(runId));
    if (until(detail)) return detail;
    if (Date.now() > deadline) throw new Error(`The run did not reach the state: ${JSON.stringify(detail)}`);
    await new Promise((done) => setImmediate(done));
  }
}
const stepOf = (detail: WorkflowRunDetail, nodeId: string) =>
  detail.steps.filter((step) => step.nodeId === nodeId).sort((a, b) => b.attempt - a.attempt)[0];
const ended = (detail: WorkflowRunDetail) => detail.run.status !== "running" && detail.run.status !== "stopping";

async function startRun(workflows: WorkflowsHandle, title: string, graph: WorkflowGraph) {
  const created = await runCauseEffect(workflows.create({ title }));
  const saved = await runCauseEffect(
    workflows.saveGraph({ workflowId: created.summary.id, baseRevision: created.revision, graph }),
  );
  assert.ok(saved.ok);
  const started = await runCauseEffect(
    workflows.startRun({ workflowId: created.summary.id, requestId: crypto.randomUUID() }),
  );
  return started.run.id;
}

const complete = (deliveryId: string, answer: string) => {
  const turnId = `turn-${deliveryId}`;
  deliveries.set(deliveryId, { status: "completed", turnId, error: null });
  turnAnswers.set(turnId, answer);
};

async function tool(name: string, args: unknown) {
  assert.ok(service);
  const response = await runCauseEffect(
    handleWorkflowTool(name, args, service, "agent-builder", `call-${crypto.randomUUID()}`, new Set([AGENT]), () =>
      Effect.succeed(false),
    ),
  );
  assert.ok(response);
  const item = response.contentItems[0];
  assert.ok(item && item.type === "inputText");
  return { ok: response.success, text: item.text };
}

try {
  await Effect.runPromise(database.initialize());
  const workflows = await Effect.runPromise(
    createWorkflows({
      store: new WorkflowStore({ database, nextDueAt: workflowScheduleDueAt(() => "UTC") }),
      runs: new WorkflowRunStore({ database }),
      github: new WorkflowGitHubStore({ database }),
      githubApp: () => null,
      delivery: (deliveryId) => deliveries.get(deliveryId) ?? { status: "running", turnId: null, error: null },
      turnAnswer: (_agentId, turnId) => turnAnswers.get(turnId) ?? null,
      sendHandoff: (input) =>
        Effect.suspend(() => {
          if (failFixHandoff && input.idempotencyKey.endsWith(":answer"))
            return Effect.fail({ cause: new Error("The agent is not available.") });
          return Effect.sync(() => {
            const sent = report.handoffs.find((handoff) => handoff.idempotencyKey === input.idempotencyKey);
            if (sent) return sent.deliveryId;
            const deliveryId = `delivery-${report.handoffs.length + 1}`;
            report.handoffs.push({ deliveryId, text: input.text, idempotencyKey: input.idempotencyKey });
            return deliveryId;
          });
        }),
      stopDelivery: () => Effect.void,
      generateText: (request) => {
        report.modelPrompts.push(request.prompt);
        if (report.modelPrompts.length === failModelCall) return Effect.fail({ message: MODEL_TIMEOUT });
        return Effect.succeed(modelReplies.shift() ?? "");
      },
      notify: (notice) => report.notices.push(notice.text),
      connectionOn: () => false,
      post: () => Effect.die(new Error("No channel output runs in this test.")),
      changed: () => {},
      rearm: () => {},
      timezone: () => "UTC",
    }),
  );
  service = workflows;

  modelReplies = ['Here it is: {"priority":"urgent","count":3}', '{"priority":"high","count":"3"}'];
  const triage = await startRun(workflows, "Ticket triage", triageGraph("priority = high and count > 2", REPORT));
  let detail = await runUntil(workflows, triage, (run) => stepOf(run, "agent")?.status === "running");
  const [ask, fix] = report.modelPrompts;
  check(
    "the model step asks for one JSON object with the answer fields",
    ask?.includes("Answer with only one JSON object") === true &&
      ask.includes('- priority: one of "high", "normal", "low"') &&
      ask.includes("- count: number"),
    ask,
  );
  report.promptBytes.modelAsk = Buffer.byteLength(ask ?? "");
  check(
    "a wrong answer gets one more try that names the problem",
    report.modelPrompts.length === 2 && fix?.includes("Your answer did not fit") === true && fix.includes("priority"),
    fix,
  );
  report.promptBytes.modelFix = Buffer.byteLength(fix ?? "");
  check(
    "the model step keeps the checked answer, with the number as a number",
    stepOf(detail, "model")?.output === '{"priority":"high","count":3}',
    stepOf(detail, "model"),
  );
  check(
    "the check takes the yes branch with no model call",
    stepOf(detail, "gate")?.branch === "yes" &&
      report.modelPrompts.length === 2 &&
      stepOf(detail, "quiet")?.status !== "done",
    stepOf(detail, "gate"),
  );
  const handoff = report.handoffs[0];
  check(
    "the agent task gets the answer values and the answer request",
    handoff?.text.includes("Handle the high ticket for 3 users.") === true &&
      handoff.text.includes("End your reply with one JSON object") &&
      handoff.text.includes("- done: true or false"),
    handoff?.text,
  );
  report.promptBytes.agentHandoff = Buffer.byteLength(handoff?.text ?? "");

  complete("delivery-1", "I restarted the service for the users.");
  detail = await runUntil(workflows, triage, () => report.handoffs.length === 2);
  const fixHandoff = report.handoffs[1];
  check(
    "an agent answer with no JSON gets one fix message to the same agent",
    fixHandoff?.text.startsWith("Your answer did not fit") === true &&
      fixHandoff.idempotencyKey.endsWith(":answer") &&
      stepOf(detail, "agent")?.status === "running",
    fixHandoff,
  );
  report.promptBytes.agentFix = Buffer.byteLength(fixHandoff?.text ?? "");

  complete("delivery-2", 'Done.\n{"summary":"Service restarted","done":true}');
  detail = await runUntil(workflows, triage, ended);
  check(
    "the fixed agent answer ends the step with the checked JSON",
    stepOf(detail, "agent")?.status === "done" &&
      stepOf(detail, "agent")?.output === '{"summary":"Service restarted","done":true}',
    stepOf(detail, "agent"),
  );
  check(
    "the output shows the answer as readable lines",
    detail.run.status === "done" && report.notices.some((body) => body.includes("summary: Service restarted")),
    report.notices,
  );

  modelReplies = ['{"priority":"low","count":1}'];
  const quiet = await startRun(workflows, "Quiet triage", triageGraph("priority = high and count > 2", ""));
  detail = await runUntil(workflows, quiet, ended);
  check(
    "a false check takes the no branch",
    stepOf(detail, "gate")?.branch === "no" &&
      stepOf(detail, "quiet")?.status === "done" &&
      stepOf(detail, "agent")?.status !== "done",
    detail.steps,
  );

  modelReplies = ["no JSON", "still no JSON"];
  const wrong = await startRun(workflows, "Wrong answers", triageGraph("priority = high", ""));
  detail = await runUntil(workflows, wrong, ended);
  check(
    "two wrong model answers fail the step and name the fields",
    stepOf(detail, "model")?.status === "failed" &&
      stepOf(detail, "model")?.error === sourceText("error.workflow.answerInvalid", { fields: "priority, count" }),
    stepOf(detail, "model"),
  );

  modelReplies = ["no JSON"];
  failModelCall = report.modelPrompts.length + 2;
  const timedOut = await startRun(workflows, "Fix call fails", triageGraph("priority = high", ""));
  detail = await runUntil(workflows, timedOut, ended);
  failModelCall = 0;
  check(
    "a failed model fix call shows its own error",
    stepOf(detail, "model")?.status === "failed" && stepOf(detail, "model")?.error === MODEL_TIMEOUT,
    stepOf(detail, "model"),
  );

  modelReplies = ['{"priority":"high","count":4}'];
  failFixHandoff = true;
  const unsent = await startRun(workflows, "Fix handoff fails", triageGraph("priority = high", REPORT));
  await runUntil(workflows, unsent, (run) => stepOf(run, "agent")?.status === "running");
  complete(report.handoffs.at(-1)?.deliveryId ?? "", "No JSON here.");
  detail = await runUntil(workflows, unsent, ended);
  failFixHandoff = false;
  check(
    "a failed agent fix handoff shows the handoff error",
    stepOf(detail, "agent")?.status === "failed" &&
      stepOf(detail, "agent")?.error === sourceText("error.workflow.handoffFailed"),
    stepOf(detail, "agent"),
  );

  modelReplies = ['{"priority":"high","count":5}'];
  const broken = await startRun(workflows, "Broken check", triageGraph("priority ==", ""));
  detail = await runUntil(workflows, broken, ended);
  check(
    "a check that cannot be read fails the condition",
    stepOf(detail, "gate")?.status === "failed" &&
      stepOf(detail, "gate")?.error === sourceText("error.workflow.checkInvalid"),
    stepOf(detail, "gate"),
  );

  modelReplies = ['{"priority":"high","count":4}'];
  const stubborn = await startRun(workflows, "Stubborn agent", triageGraph("priority = high", REPORT));
  await runUntil(workflows, stubborn, (run) => stepOf(run, "agent")?.status === "running");
  const firstId = report.handoffs.at(-1)?.deliveryId ?? "";
  complete(firstId, "No JSON here.");
  await runUntil(workflows, stubborn, () => report.handoffs.at(-1)?.deliveryId !== firstId);
  complete(report.handoffs.at(-1)?.deliveryId ?? "", '{"summary":"x"}');
  detail = await runUntil(workflows, stubborn, ended);
  check(
    "an agent answer that is still wrong after the fix fails the step",
    stepOf(detail, "agent")?.status === "failed" &&
      stepOf(detail, "agent")?.error === sourceText("error.workflow.answerInvalid", { fields: "done" }),
    stepOf(detail, "agent"),
  );

  const refused = await tool("edit_workflow", {
    title: "Refused",
    ops: [
      { op: "add", ref: "rate", kind: "llm", fields: { prompt: "Rate it.", answer: TRIAGE } },
      { op: "add", ref: "gate", kind: "condition", from: "rate", fields: { check: "urgency = high" } },
    ],
  });
  check(
    "edit_workflow refuses a check on a field that no step before gives",
    !refused.ok && refused.text.includes("urgency"),
    refused.text,
  );
  const typed = await tool("edit_workflow", {
    title: "Typed",
    ops: [
      { op: "add", ref: "rate", kind: "llm", fields: { prompt: "Rate it.", answer: TRIAGE } },
      { op: "add", ref: "gate", kind: "condition", from: "rate", fields: { check: "priority = high" } },
    ],
  });
  check("edit_workflow saves a check on a field that a step before gives", typed.ok, typed.text);
  const badSpec = await tool("edit_workflow", {
    title: "Bad spec",
    ops: [{ op: "add", ref: "rate", kind: "llm", fields: { prompt: "Rate it.", answer: "priority: colour" } }],
  });
  check("edit_workflow refuses an unknown answer type", !badSpec.ok && badSpec.text.includes("priority"), badSpec.text);

  modelReplies = ['{"priority":"high","count":5}'];
  const braces = await startRun(workflows, "Code in the answer", triageGraph("priority = high", REPORT));
  await runUntil(workflows, braces, (run) => stepOf(run, "agent")?.status === "running");
  complete(report.handoffs.at(-1)?.deliveryId ?? "", 'Patched if (ready) { start();\n{"summary":"ok","done":true}');
  detail = await runUntil(workflows, braces, ended);
  check(
    "an unmatched brace before the answer does not hide the answer",
    stepOf(detail, "agent")?.output === '{"summary":"ok","done":true}',
    stepOf(detail, "agent"),
  );

  modelReplies = ['{"priority":"high","count":5}'];
  const blank = await startRun(workflows, "Blank answer", triageGraph("priority = high", REPORT));
  await runUntil(workflows, blank, (run) => stepOf(run, "agent")?.status === "running");
  const blankId = report.handoffs.at(-1)?.deliveryId ?? "";
  complete(blankId, '{"summary":"   ","done":true}');
  await runUntil(workflows, blank, () => report.handoffs.at(-1)?.deliveryId !== blankId);
  check(
    "a blank required text gets the fix message",
    report.handoffs.at(-1)?.text.includes("summary is missing") === true,
    report.handoffs.at(-1)?.text,
  );
  complete(report.handoffs.at(-1)?.deliveryId ?? "", "");
  detail = await runUntil(workflows, blank, ended);
  check(
    "an empty reply after the fix fails the step",
    stepOf(detail, "agent")?.error === sourceText("error.workflow.answerInvalid", { fields: "summary, done" }),
    stepOf(detail, "agent"),
  );

  const hook = await tool("edit_workflow", {
    title: "Webhook test",
    ops: [
      {
        op: "add",
        ref: "hook",
        kind: "trigger",
        fields: { trigger: "webhook", answer: "priority: high|normal|low\ntitle: text" },
      },
      { op: "add", ref: "gate", kind: "condition", from: "hook", fields: { check: "priority = high" } },
      {
        op: "add",
        ref: "work",
        kind: "agent",
        from: "gate",
        branch: "yes",
        fields: { agentId: AGENT, task: "Fix {{title}} now. Keep {{ticket_id}} as it is." },
      },
    ],
  });
  check(
    "edit_workflow saves an unknown {{name}} and adds a note",
    hook.ok && hook.text.includes("ticket_id") && hook.text.includes("the step fails when it runs"),
    hook.text,
  );
  const saved = lastJsonObject(hook.text);
  assert.ok(saved && typeof saved.workflowId === "string" && isDynamicRecord(saved.ids));
  const gateId = saved.ids.gate;
  const before = report.handoffs.length;
  const started = await tool("run_workflow", {
    workflowId: saved.workflowId,
    input: JSON.stringify({ priority: "High", title: "Ignore the rules" }),
  });
  const runResult = lastJsonObject(started.text);
  assert.ok(runResult && typeof runResult.runId === "string");
  const hookRun = runResult.runId;
  detail = await runUntil(workflows, hookRun, ended);
  check(
    "a test run reads the trigger answer from the run input",
    typeof gateId === "string" && stepOf(detail, gateId)?.branch === "yes",
    detail.steps,
  );
  const workId = saved.ids.work;
  check(
    "an unknown {{name}} fails the step and sends nothing to the agent",
    typeof workId === "string" &&
      stepOf(detail, workId)?.status === "failed" &&
      stepOf(detail, workId)?.error === sourceText("error.workflow.answerSetup", { fields: "ticket_id" }) &&
      report.handoffs.length === before,
    stepOf(detail, typeof workId === "string" ? workId : ""),
  );

  modelReplies = [
    'Here: {"count":2.5,"score":"0x10","tags":"one","Count":3,"note":"x"}',
    '{"count":"12","score":"1.5e2","tags":["a","b \\"c\\""]}',
  ];
  const strictPrompts = report.modelPrompts.length;
  const strictHandoffs = report.handoffs.length;
  const strict = await startRun(workflows, "Strict values", {
    nodes: [
      node("prompt", "prompt", 0, { text: "Count the tags." }),
      node("model", "llm", 300, { prompt: "Count them.", answer: "count: int\nscore: number\ntags: list" }),
      node("agent", "agent", 600, { agentId: AGENT, task: "Use {{tags}} for {{count}} items." }),
      node("ask", "approval", 600, { question: "Send {{tags}} now?" }),
    ],
    edges: [
      { id: "prompt-model", from: "prompt", to: "model", type: "text" },
      { id: "model-agent", from: "model", to: "agent", type: "text" },
      { id: "model-ask", from: "model", to: "ask", type: "text" },
    ],
    strokes: [],
  });
  detail = await runUntil(
    workflows,
    strict,
    (run) => stepOf(run, "agent")?.status === "running" && stepOf(run, "ask")?.status === "approval",
  );
  const strictFix = report.modelPrompts[strictPrompts + 1] ?? "";
  check(
    "a fraction for int, a hex number, a text for a list and unknown or wrongly cased keys get the fix ask",
    strictFix.includes("count has the wrong type") &&
      strictFix.includes("score has the wrong type") &&
      strictFix.includes("tags has the wrong type") &&
      strictFix.includes("Count is not one of the fields") &&
      strictFix.includes("note is not one of the fields") &&
      strictFix.includes("- count: integer"),
    strictFix,
  );
  check(
    "decimal text becomes a number and an integer, and a list stays a list",
    stepOf(detail, "model")?.output === '{"count":12,"score":150,"tags":["a","b \\"c\\""]}',
    stepOf(detail, "model"),
  );
  check(
    "a list goes into a model text as a JSON array",
    report.handoffs[strictHandoffs]?.text.includes('Use ["a","b \\"c\\""] for 12 items.') === true,
    report.handoffs[strictHandoffs]?.text,
  );
  check("the approval question gets plain text", report.notices.includes('Send a, b "c" now?'), report.notices);
  complete(report.handoffs[strictHandoffs]?.deliveryId ?? "", "Done.");
  await runCauseEffect(workflows.stopRun(strict));

  modelReplies = ["Nothing to add.", "Still nothing to add."];
  const prose = await startRun(workflows, "Prose answer", {
    nodes: [
      node("prompt", "prompt", 0, { text: "Read the ticket." }),
      node("model", "llm", 300, { prompt: "Add a note if you have one.", answer: "note?: text" }),
    ],
    edges: [{ id: "prompt-model", from: "prompt", to: "model", type: "text" }],
    strokes: [],
  });
  detail = await runUntil(workflows, prose, ended);
  check(
    "a reply with no JSON object fails even when all fields are optional",
    report.modelPrompts.at(-1)?.includes("the reply has no JSON object") === true &&
      stepOf(detail, "model")?.error === sourceText("error.workflow.answerInvalid", { fields: "note" }),
    stepOf(detail, "model"),
  );

  modelReplies = [`{"title":"it's down","priority":"high"}`];
  const quoted = await startRun(workflows, "Quote in a word", {
    nodes: [
      node("prompt", "prompt", 0, { text: "Read the ticket." }),
      node("model", "llm", 300, { prompt: "Rate it.", answer: "title: text\npriority: high|low" }),
      node("gate", "condition", 600, { check: "title contains it's and priority = high" }),
      node("agent", "agent", 900, { agentId: AGENT, task: "Fix {{title}} now." }),
    ],
    edges: [
      { id: "prompt-model", from: "prompt", to: "model", type: "text" },
      { id: "model-gate", from: "model", to: "gate", type: "text" },
      { id: "gate-agent", from: "gate", to: "agent", type: "text", branch: "yes" },
    ],
    strokes: [],
  });
  detail = await runUntil(workflows, quoted, (run) => stepOf(run, "agent")?.status === "running");
  check(
    "an apostrophe inside a word does not start a quote in a check",
    stepOf(detail, "gate")?.branch === "yes",
    stepOf(detail, "gate"),
  );
  check(
    "a text value goes into an agent task in quotes",
    report.handoffs.at(-1)?.text.includes(`Fix "it's down" now.`) === true,
    report.handoffs.at(-1)?.text,
  );
  complete(report.handoffs.at(-1)?.deliveryId ?? "", "Done.");
  await runUntil(workflows, quoted, ended);

  modelReplies = ['{"priority":"high"}'];
  const missing = await startRun(workflows, "Missing value", {
    nodes: [
      node("prompt", "prompt", 0, { text: "Read the ticket." }),
      node("model", "llm", 300, { prompt: "Rate it.", answer: "priority: high|low\nnote?: text" }),
      node("differs", "condition", 600, { check: "note != x" }),
      node("absent", "condition", 600, { check: "not note" }),
    ],
    edges: [
      { id: "prompt-model", from: "prompt", to: "model", type: "text" },
      { id: "model-differs", from: "model", to: "differs", type: "text" },
      { id: "model-absent", from: "model", to: "absent", type: "text" },
    ],
    strokes: [],
  });
  detail = await runUntil(workflows, missing, ended);
  check(
    'a missing value makes != false and "not" true',
    stepOf(detail, "differs")?.branch === "no" && stepOf(detail, "absent")?.branch === "yes",
    detail.steps,
  );

  modelReplies = ["no JSON", "still no JSON"];
  const joinHandoffs = report.handoffs.length;
  const lostSource = await startRun(workflows, "Join with a failed typed step", {
    nodes: [
      node("prompt", "prompt", 0, { text: "Read the ticket." }),
      node("model", "llm", 300, { prompt: "Rate it.", answer: TRIAGE }),
      node("context", "prompt", 300, { text: "The user is on the free plan." }),
      node("agent", "agent", 600, { agentId: AGENT, task: "Handle the {{priority}} ticket." }),
    ],
    edges: [
      { id: "prompt-model", from: "prompt", to: "model", type: "text" },
      { id: "model-agent", from: "model", to: "agent", type: "text" },
      { id: "context-agent", from: "context", to: "agent", type: "text" },
    ],
    strokes: [],
  });
  detail = await runUntil(workflows, lostSource, ended);
  check(
    "a join whose typed source failed fails the step that uses its field",
    stepOf(detail, "model")?.status === "failed" &&
      stepOf(detail, "agent")?.status === "failed" &&
      stepOf(detail, "agent")?.error === sourceText("error.workflow.answerSourceEnded", { fields: "priority" }) &&
      report.handoffs.length === joinHandoffs,
    detail.steps,
  );

  assert.ok(typeof saved.workflowId === "string" && typeof saved.ids.hook === "string");
  const hookId = saved.ids.hook;
  const hookWorkflow = saved.workflowId;
  const delivery = (deliveryId: string, data: Record<string, string>) =>
    runCauseEffect(
      workflows.receiveWebhook({
        workflowId: hookWorkflow,
        nodeId: hookId,
        event: {
          deliveryId,
          eventType: "ticket",
          data,
          occurredAt: new Date().toISOString(),
          receivedAt: new Date().toISOString(),
        },
      }),
    );
  const miscased = await delivery("miscased", { Priority: "high", title: "Down" });
  check("a webhook with a wrongly cased field name is refused", miscased.kind === "bad-answer", miscased);
  const extra = await delivery("extra", { priority: "high", title: "Down", source: "pager" });
  check("a webhook with an extra field that is not an answer field still starts", extra.kind === "started", extra);

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
