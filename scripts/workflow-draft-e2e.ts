// Checks the Ask AI chat drafts on the real SQLite and the real workflow service, on a temporary profile.
// The model is a script of answers, so no provider, account or network is started. A question changes
// nothing. A draft that names an unknown agent goes back to the model once with the reason; the next
// answer saves with ids, port types, branches and positions from the host, keeps the annotations, and
// keeps the graph before it as a `restore` version. An edit keeps the ids of the steps it keeps, and
// its prompt has the chat before it. A schedule that the host refuses goes back to the model. A stale
// revision and two bad answers change nothing.
//
// Run: bun scripts/workflow-draft-e2e.ts
// Writes .openbot-build/workflow-draft-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type WorkflowGraph, workflowGraphProblem } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { WorkflowGitHubStore } from "../src/backend/workflows/workflow-github-store";
import { WorkflowRunStore } from "../src/backend/workflows/workflow-run-store";
import { WorkflowStore } from "../src/backend/workflows/workflow-store";
import { workflowScheduleDueAt } from "../src/backend/workflows/workflow-triggers";
import { createWorkflows, type WorkflowsHandle } from "../src/backend/workflows/workflows";

const OUT = resolve(import.meta.dirname, "../.openbot-build/workflow-draft-e2e");

interface Report {
  checks: string[];
  prompts: string[];
  graph?: WorkflowGraph;
  passed: boolean;
  failure?: string;
}

const report: Report = { checks: [], prompts: [], passed: false };
const check = (name: string, ok: boolean, detail?: unknown) => {
  assert.ok(ok, `${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  report.checks.push(name);
};

const CONTEXT = {
  agents: [{ id: "agent-1", name: "Researcher", description: "Reads the news", provider: "codex", model: "gpt-5" }],
  places: [{ connectionId: "slack-1", placeId: "C1", label: "Team · #news" }],
};

const START: WorkflowGraph = {
  nodes: [
    { id: "note-1", kind: "note", at: { x: -400, y: -400 }, fields: { text: "Keep me" } },
    { id: "old-prompt", kind: "prompt", at: { x: 100, y: 50 }, fields: { text: "Old" } },
  ],
  edges: [],
  strokes: [],
};

const DRAFT = {
  reply: "Added a weekday news check that posts when there is news.",
  nodes: [
    { id: "t", kind: "trigger", fields: { trigger: "schedule" }, schedule: { kind: "weekdays", time: "09:00" } },
    { id: "a", kind: "agent", fields: { agentId: "agent-1", task: "Find the news." } },
    { id: "c", kind: "condition", fields: { rule: "Is there news?" } },
    { id: "ok", kind: "approval", fields: { question: "Post it?" } },
    { id: "post", kind: "output", fields: { target: "channel", connectionId: "slack-1", placeId: "C1" } },
    { id: "none", kind: "output", fields: { target: "notify" } },
  ],
  edges: [
    { from: "t", to: "a" },
    { from: "a", to: "c" },
    { from: "c", to: "ok", branch: "yes" },
    { from: "ok", to: "post" },
    { from: "c", to: "none", branch: "no" },
  ],
};

/** The answers the model gives, in order. */
const answers: string[] = [];
const directory = await mkdtemp(join(tmpdir(), "openbot-workflow-draft-"));
const database = new OpenBotDatabase(directory);
let service: WorkflowsHandle | null = null;

async function open() {
  await Effect.runPromise(database.initialize());
  service = await Effect.runPromise(
    createWorkflows({
      store: new WorkflowStore({ database, nextDueAt: workflowScheduleDueAt(() => "UTC") }),
      runs: new WorkflowRunStore({ database }),
      github: new WorkflowGitHubStore({ database }),
      githubApp: () => null,
      delivery: () => null,
      turnAnswer: () => null,
      sendHandoff: () => Effect.fail({ cause: new Error("No agent step runs in this test.") }),
      stopDelivery: () => Effect.void,
      generateText: (request) => {
        report.prompts.push(request.prompt);
        const answer = answers.shift();
        return answer === undefined ? Effect.fail({ message: "No answer left." }) : Effect.succeed(answer);
      },
      draftContext: () => Effect.succeed(CONTEXT),
      notify: () => {},
      connectionOn: () => false,
      post: () => Effect.die(new Error("No post runs in this test.")),
      changed: () => {},
      rearm: () => {},
      timezone: () => "UTC",
    }),
  );
  return service;
}

async function close() {
  if (service) await Effect.runPromise(service.close()).catch(() => {});
  service = null;
  database.close();
}

const refusal = (call: Promise<unknown>) =>
  call.then(
    () => "",
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

try {
  const workflows = await open();
  const created = await runCauseEffect(workflows.create({ title: "Draft" }));
  const workflowId = created.summary.id;
  const saved = await runCauseEffect(workflows.saveGraph({ workflowId, baseRevision: created.revision, graph: START }));
  assert.ok(saved.ok);

  answers.push(JSON.stringify({ reply: "Which agent should find the news?" }));
  const asked = await runCauseEffect(
    workflows.draft({ workflowId, baseRevision: saved.revision, request: "Find news.", history: [] }),
  );
  check("a question comes back as the reply", asked.reply === "Which agent should find the news?", asked);
  check("a question changes nothing", asked.detail === null);
  check("a question keeps the revision", (await runCauseEffect(workflows.get(workflowId))).revision === saved.revision);
  const history = [
    { role: "user" as const, text: "Find news." },
    { role: "assistant" as const, text: asked.reply },
  ];
  report.prompts.length = 0;

  answers.push(
    JSON.stringify({
      ...DRAFT,
      nodes: DRAFT.nodes.map((node) =>
        node.id === "a" ? { ...node, fields: { agentId: "nobody", task: "x" } } : node,
      ),
    }),
    `Here it is:\n\`\`\`json\n${JSON.stringify(DRAFT)}\n\`\`\``,
  );
  const reply = await runCauseEffect(
    workflows.draft({
      workflowId,
      baseRevision: saved.revision,
      request: "The Researcher, every weekday, and post it.",
      history,
    }),
  );
  check("the draft reply comes back", reply.reply === DRAFT.reply, reply.reply);
  const drafted = reply.detail;
  assert.ok(drafted, "the draft saved");
  check("a refused answer goes back to the model once", report.prompts.length === 2);
  check("the second prompt names the reason", report.prompts[1]?.includes("agent list") === true, report.prompts[1]);
  check(
    "the first prompt shows the current steps and the agents",
    report.prompts[0]?.includes("old-prompt") === true && report.prompts[0]?.includes("agent-1") === true,
  );
  check(
    "the prompt has the chat before the request",
    report.prompts[0]?.includes("Which agent should find the news?") === true,
  );

  const graph = drafted.graph;
  report.graph = graph;
  const steps = graph.nodes.filter((node) => node.kind !== "note");
  check("the draft is a graph that runs", workflowGraphProblem(graph) === null);
  check(
    "the draft has the six steps",
    steps.length === 6,
    steps.map((node) => node.kind),
  );
  check(
    "the note stays",
    graph.nodes.some((node) => node.id === "note-1" && node.fields.text === "Keep me"),
  );
  check("the replaced prompt is gone", !graph.nodes.some((node) => node.id === "old-prompt"));
  const byKind = (kind: string) => steps.filter((node) => node.kind === kind);
  const [trigger] = byKind("trigger");
  const [agent] = byKind("agent");
  const [condition] = byKind("condition");
  check("the schedule saves", trigger?.schedule?.kind === "weekdays", trigger);
  check(
    "the agent card gets the agent's model",
    agent?.fields.provider === "codex" && agent.fields.model === "gpt-5",
    agent,
  );
  check(
    "each edge out of the condition has its branch",
    graph.edges.filter((edge) => edge.from === condition?.id).every((edge) => edge.branch !== undefined) &&
      graph.edges.filter((edge) => edge.from === condition?.id).length === 2,
  );
  check(
    "the edges carry text",
    graph.edges.every((edge) => edge.type === "text"),
  );
  check(
    "the steps go left to right by distance from the trigger, from the old top left",
    trigger !== undefined &&
      agent !== undefined &&
      condition !== undefined &&
      trigger.at.x === 100 &&
      trigger.at.y === 50 &&
      trigger.at.x < agent.at.x &&
      agent.at.x < condition.at.x,
    { trigger: trigger?.at, agent: agent?.at, condition: condition?.at },
  );
  const versions = await runCauseEffect(workflows.versions(workflowId));
  const restore = versions.find((version) => version.kind === "restore");
  check("the graph before the draft is a restore version", restore !== undefined, versions);
  const before = restore && (await runCauseEffect(workflows.versionGraph({ workflowId, versionId: restore.id })));
  check("the restore version has the old prompt", before?.nodes.some((node) => node.id === "old-prompt") === true);

  // An edit that keeps the trigger and the agent, by their ids on the canvas. Its first answer runs
  // every minute, which the host refuses, so the reason goes back to the model.
  answers.push(
    JSON.stringify({
      nodes: [
        {
          id: trigger?.id,
          kind: "trigger",
          fields: { trigger: "schedule" },
          schedule: { kind: "interval", amount: 1, unit: "minutes", anchorAt: "2026-01-01T00:00:00.000Z" },
        },
        { id: "n", kind: "output", fields: { target: "notify" } },
      ],
      edges: [{ from: trigger?.id, to: "n" }],
    }),
  );
  const beforeEdit = report.prompts.length;
  answers.push(
    JSON.stringify({
      nodes: [
        { id: trigger?.id, kind: "trigger", fields: { trigger: "manual" } },
        { id: agent?.id, kind: "agent", fields: { agentId: "agent-1", task: "Find more news." } },
        { id: "n", kind: "output", fields: { target: "notify" } },
      ],
      edges: [
        { from: trigger?.id, to: agent?.id },
        { from: agent?.id, to: "n" },
      ],
    }),
  );
  const editReply = await runCauseEffect(
    workflows.draft({
      workflowId,
      baseRevision: drafted.revision,
      request: "Run it by hand, and just notify me.",
      history,
    }),
  );
  const edited = editReply.detail;
  assert.ok(edited, "the edit saved");
  check("a refused schedule goes back to the model", report.prompts.length === beforeEdit + 2);
  check(
    "the second prompt names the schedule rule",
    report.prompts.at(-1)?.includes("at least 3 minutes") === true,
    report.prompts.at(-1)?.split("refused:")[1],
  );
  check("an answer with no reply still saves", editReply.reply === "");
  const keptAgent = edited.graph.nodes.find((node) => node.id === agent?.id);
  check("an edit keeps the ids of kept steps", keptAgent?.fields.task === "Find more news.", edited.graph.nodes);
  check(
    "a trigger that is no longer a schedule has no schedule",
    edited.graph.nodes.find((node) => node.id === trigger?.id)?.schedule === undefined,
  );

  const stale = await refusal(
    runCauseEffect(workflows.draft({ workflowId, baseRevision: drafted.revision, request: "x", history: [] })),
  );
  check("a stale revision is refused", stale === sourceText("error.workflow.draftChanged"), stale);

  const prompts = report.prompts.length;
  answers.push("No JSON here.", '{"nodes": []}');
  const failed = await refusal(
    runCauseEffect(workflows.draft({ workflowId, baseRevision: edited.revision, request: "x", history: [] })),
  );
  check("two bad answers fail with the draft message", failed === sourceText("error.workflow.draftFailed"), failed);
  check("they asked the model twice", report.prompts.length === prompts + 2);
  check("they change nothing", (await runCauseEffect(workflows.get(workflowId))).revision === edited.revision);

  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await close();
  await rm(directory, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${report.passed ? "passed" : "FAILED"}: ${report.checks.length} checks; ${OUT}/report.json\n`);
  if (report.failure) process.stderr.write(`${report.failure}\n`);
  process.exitCode = report.passed ? 0 : 1;
}
