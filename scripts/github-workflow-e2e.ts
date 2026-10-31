// Checks the GitHub triggers of workflows on the real SQLite and the real workflow service, on a
// temporary profile. The events go through `receiveGitHubDelivery`, as the ingress socket gives them: a
// comment starts a run; a second comment on the same issue waits and starts when the first run ends; a
// comment on another issue runs at the same time; the same delivery again records nothing; a bot that is
// not OpenBot's is refused by "not a bot"; an echo of the workflow's own comment is skipped (`self`);
// the fourth run of a chain that OpenBot's bot caused on one issue is skipped (`chain`); an event of a
// repository that no trigger watches gets 404 and a body that is not JSON gets 400; two close times
// offline are one gap. A fake GitHub API takes the changes of GitHub outputs: a comment output posts
// once, with the text of the step before it and not the event, and the event of that comment is skipped
// (`self`); a comment output with only the trigger's event posts nothing; a change that is done already
// is not made again; each pass of a loop posts its own comment; "Agent chooses" gives the repository's
// own label; a restart while a comment is on its way does not post it again, but sends a label again;
// "Run with last event" starts a run with the newest matching item. No app, provider, account, Signal or
// network is started.
//
// Run: bun scripts/github-workflow-e2e.ts
// Writes .openbot-build/github-workflow-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { WorkflowGitHubHistory, WorkflowGraph, WorkflowNode } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import type { WorkflowGitHubApi, WorkflowGitHubChange } from "../src/backend/workflows/workflow-github-api";
import { WorkflowGitHubStore } from "../src/backend/workflows/workflow-github-store";
import { WorkflowRunStore } from "../src/backend/workflows/workflow-run-store";
import { WorkflowStore } from "../src/backend/workflows/workflow-store";
import { workflowScheduleDueAt } from "../src/backend/workflows/workflow-triggers";
import {
  createWorkflows,
  type WorkflowRunEnd,
  type WorkflowsDependencies,
  type WorkflowsHandle,
} from "../src/backend/workflows/workflows";
import { receiveGitHubDelivery } from "../src/main/github-relay";

const OUT = resolve(import.meta.dirname, "../.openbot-build/github-workflow-e2e");
const BOT = "openbotgit";

interface Report {
  checks: string[];
  watched?: string[];
  history?: WorkflowGitHubHistory;
  changes?: WorkflowGitHubChange[];
  passed: boolean;
  failure?: string;
}

const report: Report = { checks: [], passed: false };
const check = (name: string, ok: boolean, detail?: unknown) => {
  assert.ok(ok, `${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  report.checks.push(name);
};

/** A GitHub trigger on comments, and an approval that keeps each run open, or a notice that ends it. */
const graphOf = (repository: string, step: "approval" | "notify", filters = ""): WorkflowGraph => ({
  nodes: [
    {
      id: "trigger",
      kind: "trigger",
      at: { x: 0, y: 0 },
      fields: { trigger: "github", repository, event: "comment", filters },
    },
    step === "approval"
      ? { id: "step", kind: "approval", at: { x: 300, y: 0 }, fields: { question: "Go on?" } }
      : { id: "step", kind: "output", at: { x: 300, y: 0 }, fields: { target: "notify" } },
  ],
  edges: [{ id: "edge", from: "trigger", to: "step", type: "text" }],
  strokes: [],
});

/** A GitHub trigger on comments of `repository`, then `steps` in a line. */
const lineOf = (repository: string, steps: WorkflowNode[], filters = ""): WorkflowGraph => {
  const nodes: WorkflowNode[] = [
    {
      id: "trigger",
      kind: "trigger",
      at: { x: 0, y: 0 },
      fields: { trigger: "github", repository, event: "comment", filters },
    },
    ...steps,
  ];
  return {
    nodes,
    edges: nodes.slice(1).map((node, index) => ({
      id: `edge-${index}`,
      from: nodes[index]?.id ?? "",
      to: node.id,
      type: "text" as const,
    })),
    strokes: [],
  };
};
/** The text that a prompt node gives a comment output, next to the trigger's event. */
const SAY = "Thanks, I look at it.";
/** `graph` with a prompt node that gives its output `SAY`. */
const saying = (graph: WorkflowGraph): WorkflowGraph => ({
  ...graph,
  nodes: [...graph.nodes, { id: "say", kind: "prompt", at: { x: 300, y: 200 }, fields: { text: SAY } }],
  edges: [...graph.edges, { id: "edge-say", from: "say", to: "out", type: "text" }],
});
const githubOutput = (fields: Record<string, string>): WorkflowNode => ({
  id: "out",
  kind: "output",
  at: { x: 600, y: 0 },
  fields: { target: "github", repository: "trigger", ...fields },
});

let commentId = 100;
/** An `issue_comment` body as GitHub sends it, with only the fields that the host reads. */
const comment = (repository: string, number: number, login: string, type: "User" | "Bot" = "User") => {
  commentId += 1;
  return {
    id: commentId,
    body: JSON.stringify({
      action: "created",
      repository: { full_name: repository },
      sender: { login, type },
      issue: { number, title: `Issue ${number}`, body: "Steps to see it.", labels: [], user: { login: "ana" } },
      comment: { id: commentId, body: `Comment ${commentId}`, user: { login }, author_association: "MEMBER" },
    }),
  };
};

const directory = await mkdtemp(join(tmpdir(), "openbot-github-workflow-"));
const database = new OpenBotDatabase(directory);
let service: WorkflowsHandle | null = null;

try {
  await Effect.runPromise(database.initialize());
  const watched: string[][] = [];
  // The fake GitHub API: each change is kept; the first change on `acme/slow` and `acme/slowlabel` gets no answer.
  const changes: WorkflowGitHubChange[] = [];
  report.changes = changes;
  const changeWaiters: Array<() => void> = [];
  const changeMade = () => new Promise<void>((resolve) => changeWaiters.push(resolve));
  let createdId = 9_000;
  const hung = new Set<string>();
  const githubApi: WorkflowGitHubApi = {
    change: (change) =>
      Effect.suspend(() => {
        changes.push(change);
        for (const resolve of changeWaiters.splice(0)) resolve();
        if (change.repository.startsWith("acme/slow") && !hung.has(change.repository)) {
          hung.add(change.repository);
          return Effect.never;
        }
        createdId += 1;
        return Effect.succeed({
          created: change.action === "comment" ? { kind: "comment" as const, id: createdId } : null,
          url: null,
        });
      }),
    options: () =>
      Effect.succeed({
        labels: [
          { name: "Bug", color: "d73a4a" },
          { name: "docs", color: "0075ca" },
        ],
        people: ["ana", "ben"],
      }),
    recentEvents: (repository) =>
      Effect.succeed([
        { event: "issue_comment", body: JSON.parse(comment(repository, 11, "dependabot[bot]", "Bot").body) },
        { event: "issue_comment", body: JSON.parse(comment(repository, 12, "ana").body) },
      ]),
  };
  const runEnds = new Map<string, (end: WorkflowRunEnd) => void>();
  const ended = new Map<string, WorkflowRunEnd>();
  /** The end of a run, when it comes. */
  const runEnd = (runId: string) =>
    new Promise<WorkflowRunEnd>((resolve) => {
      const done = ended.get(runId);
      if (done) resolve(done);
      else runEnds.set(runId, resolve);
    });
  const dependencies: WorkflowsDependencies = {
    store: new WorkflowStore({ database, nextDueAt: workflowScheduleDueAt(() => "UTC") }),
    runs: new WorkflowRunStore({ database }),
    github: new WorkflowGitHubStore({ database }),
    githubApp: () => BOT,
    watchGitHub: (repositories) => watched.push(repositories),
    githubApi,
    delivery: () => null,
    turnAnswer: () => null,
    sendHandoff: () => Effect.fail({ cause: new Error("No agent step runs in this test.") }),
    stopDelivery: () => Effect.void,
    // "Agent chooses" asks once; the answer names a label in another case and one that the repository lacks.
    generateText: () => Effect.succeed('{"labels": ["bug", "wontfix"]}'),
    notify: () => {},
    connectionOn: () => false,
    post: () => Effect.die(new Error("No output posts in this test.")),
    changed: () => {},
    rearm: () => {},
    timezone: () => "UTC",
    runEnded: (end) => {
      ended.set(end.runId, end);
      runEnds.get(end.runId)?.(end);
    },
  };
  let workflows = await Effect.runPromise(createWorkflows(dependencies));
  service = workflows;
  const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
  let deliveryNumber = 0;
  const send = (body: string, deliveryId = `delivery-${++deliveryNumber}`) =>
    run(
      receiveGitHubDelivery(workflows, {
        event: "issue_comment",
        deliveryId,
        body: new TextEncoder().encode(body),
      }),
    ).then((answer) => ({ ...answer, deliveryId }));
  const history = (workflowId: string) => run(workflows.githubHistory(workflowId));
  const delivery = async (workflowId: string, deliveryId: string) =>
    (await history(workflowId)).deliveries.find((candidate) => candidate.id === deliveryId);

  const queue = await run(
    workflows.create({ title: "Answer comments", graph: graphOf("acme/app", "approval", "notBot") }),
  );
  const chain = await run(workflows.create({ title: "Chain", graph: graphOf("acme/chain", "notify") }));
  report.watched = watched.at(-1) ?? [];
  check(
    "the saved triggers set the watched repositories",
    [...report.watched].sort().join() === "acme/app,acme/chain",
    watched,
  );

  // One run per item, and items in parallel.
  const first = await send(comment("acme/app", 1, "ana").body);
  check("a comment is saved", first.status === 202, first);
  const firstRow = await delivery(queue.summary.id, first.deliveryId);
  check("a comment starts a run", firstRow?.outcome === "started" && firstRow.runId !== null, firstRow);
  const second = await send(comment("acme/app", 1, "ben").body);
  check(
    "a second comment on the issue waits",
    (await delivery(queue.summary.id, second.deliveryId))?.outcome === "waiting",
  );
  const other = await send(comment("acme/app", 2, "ana").body);
  const otherRow = await delivery(queue.summary.id, other.deliveryId);
  check("a comment on another issue runs at the same time", otherRow?.outcome === "started", otherRow);
  const again = await send(comment("acme/app", 2, "ana").body, other.deliveryId);
  const otherRows = (await history(queue.summary.id)).deliveries.filter((row) => row.id === other.deliveryId);
  check("the same delivery again records nothing", again.status === 202 && otherRows.length === 1, otherRows);

  // The first run ends: its item's waiting comment starts.
  const firstRun = await run(workflows.run(firstRow?.runId ?? ""));
  const approval = firstRun.steps.find((step) => step.status === "approval");
  check("the first run waits for its approval", approval !== undefined, firstRun.steps);
  await run(workflows.decide({ stepId: approval?.id ?? "", approved: true }));
  await run(workflows.sweep());
  const started = await delivery(queue.summary.id, second.deliveryId);
  check("the waiting comment starts when the run of its issue ends", started?.outcome === "started", started);
  const runs = (await history(queue.summary.id)).runs;
  check(
    "the history names the item of each run",
    runs.some((entry) => entry.runId === started?.runId && entry.item.number === 1),
    runs,
  );

  // Filters and the loop guard.
  const dependabot = await send(comment("acme/app", 3, "dependabot[bot]", "Bot").body);
  const dependabotRow = await delivery(queue.summary.id, dependabot.deliveryId);
  check('"not a bot" refuses another bot', dependabotRow?.reason === "filter", dependabotRow);
  const echo = comment("acme/app", 4, `${BOT}[bot]`, "Bot");
  const at = new Date().toISOString();
  database.connection
    .prepare(
      `INSERT INTO workflow_github_actions (action_key, workflow_id, run_id, step_id, repository, number, action, status,
         object_id, created_at, updated_at)
       VALUES ('echo', ?, ?, 'step', 'acme/app', 4, 'comment', 'done', ?, ?, ?)`,
    )
    .run(queue.summary.id, firstRow?.runId ?? "", `comment:${echo.id}`, at, at);
  const echoed = await send(echo.body);
  const echoRow = await delivery(queue.summary.id, echoed.deliveryId);
  check("an echo of the workflow's own comment is skipped", echoRow?.reason === "self", echoRow);

  const chainRows = [];
  for (let index = 0; index < 4; index += 1) {
    const sent = await send(comment("acme/chain", 9, `${BOT}[bot]`, "Bot").body);
    chainRows.push(await delivery(chain.summary.id, sent.deliveryId));
  }
  check(
    "OpenBot's bot starts runs until the chain is too long",
    chainRows.slice(0, 3).every((row) => row?.outcome === "started") && chainRows[3]?.reason === "chain",
    chainRows,
  );

  const unwatched = await send(comment("acme/other", 1, "ana").body);
  check("an event of a repository that no trigger watches gets 404", unwatched.status === 404, unwatched);
  const invalid = await send("{");
  check("a body that is not JSON gets 400", invalid.status === 400, invalid);

  // Two close times offline are one gap. The host writes a gap when it connects again, after the events before it.
  const now = Date.now() + 1_000;
  await run(workflows.githubOffline(new Date(now), new Date(now + 30_000)));
  await run(workflows.githubOffline(new Date(now + 60_000), new Date(now + 90_000)));
  const gaps = (await history(chain.summary.id)).deliveries.filter((row) => row.reason === "offline");
  check(
    "two close times offline are one gap",
    gaps.length === 1 && gaps[0]?.receivedAt === new Date(now + 90_000).toISOString(),
    gaps,
  );

  // GitHub outputs.
  const outputStep = async (runId: string) =>
    (await run(workflows.run(runId))).steps.find((step) => step.nodeId === "out");
  const startedRun = async (workflowId: string, body: string) => {
    const sent = await send(body);
    const row = await delivery(workflowId, sent.deliveryId);
    assert.ok(row?.runId, `no run: ${JSON.stringify(row)}`);
    return row.runId;
  };

  const reply = await run(
    workflows.create({ title: "Reply", graph: saying(lineOf("acme/out", [githubOutput({ action: "comment" })])) }),
  );
  const replyRun = await startedRun(reply.summary.id, comment("acme/out", 5, "ana").body);
  const replyEnd = await runEnd(replyRun);
  const replyStep = await outputStep(replyRun);
  const posted = changes.filter((change) => change.repository === "acme/out");
  check(
    "a comment output posts one comment on the run's issue, with the text and not the event",
    replyEnd.status === "done" &&
      posted.length === 1 &&
      posted[0]?.number === 5 &&
      posted[0]?.body === SAY &&
      replyStep?.output === "acme/out#5",
    { replyEnd, posted, replyStep },
  );
  const ownComment = comment("acme/out", 5, `${BOT}[bot]`, "Bot");
  const ownBody = JSON.parse(ownComment.body);
  ownBody.comment.id = createdId;
  const own = await send(JSON.stringify(ownBody));
  const ownRow = await delivery(reply.summary.id, own.deliveryId);
  check("the event of the output's own comment is skipped", ownRow?.reason === "self", ownRow);

  const hold = await run(
    workflows.create({
      title: "Hold",
      graph: saying(
        lineOf("acme/hold", [
          { id: "ask", kind: "approval", at: { x: 300, y: 0 }, fields: { question: "Go on?" } },
          githubOutput({ action: "comment" }),
        ]),
      ),
    }),
  );
  const holdRun = await startedRun(hold.summary.id, comment("acme/hold", 6, "ana").body);
  // A change that a run made before, as after a restart between GitHub's answer and the step's end.
  const doneAt = new Date().toISOString();
  database.connection
    .prepare(
      `INSERT INTO workflow_github_actions (action_key, workflow_id, run_id, step_id, repository, number, action, status,
         object_id, created_at, updated_at)
       VALUES (?, ?, ?, 'earlier', 'acme/hold', 6, 'comment', 'done', 'comment:1', ?, ?)`,
    )
    .run(`${holdRun}:out:0`, hold.summary.id, holdRun, doneAt, doneAt);
  const holdApproval = (await run(workflows.run(holdRun))).steps.find((step) => step.status === "approval");
  await run(workflows.decide({ stepId: holdApproval?.id ?? "", approved: true }));
  const holdEnd = await runEnd(holdRun);
  check(
    "a change that is done already is not made again",
    holdEnd.status === "done" && !changes.some((change) => change.repository === "acme/hold"),
    { holdEnd, changes },
  );

  const raw = await run(
    workflows.create({ title: "Raw", graph: lineOf("acme/raw", [githubOutput({ action: "comment" })]) }),
  );
  const rawRun = await startedRun(raw.summary.id, comment("acme/raw", 9, "ana").body);
  const rawEnd = await runEnd(rawRun);
  const rawStep = await outputStep(rawRun);
  check(
    "a comment output with only the trigger's event posts nothing",
    rawEnd.status === "failed" &&
      rawStep?.error === sourceText("error.workflow.githubEventText") &&
      !changes.some((change) => change.repository === "acme/raw"),
    { rawEnd, rawStep },
  );

  // Each pass of a loop makes its own change.
  const loopLine = lineOf("acme/loop", [
    { id: "review", kind: "approval", at: { x: 300, y: 0 }, fields: { question: "Review?" } },
    { id: "again", kind: "approval", at: { x: 450, y: 0 }, fields: { question: "Again?" } },
    githubOutput({ action: "comment" }),
  ]);
  const loop = await run(
    workflows.create({
      title: "Loop",
      graph: saying({
        ...loopLine,
        edges: [...loopLine.edges, { id: "edge-loop", from: "again", to: "review", type: "text" }],
      }),
    }),
  );
  const loopRun = await startedRun(loop.summary.id, comment("acme/loop", 10, "ana").body);
  const loopPosts = () => changes.filter((change) => change.repository === "acme/loop");
  /** Waits until `ready` is true, at each turn of the event loop. */
  const until = async (ready: () => boolean | Promise<boolean>) => {
    const deadline = Date.now() + 5_000;
    while (!(await ready())) {
      if (Date.now() > deadline) throw new Error("The loop run did not get to the next state.");
      await new Promise((done) => setImmediate(done));
    }
  };
  /** Decides the step of `nodeId` that waits for a decision. */
  const decideAt = async (nodeId: string, approved: boolean) => {
    let stepId = "";
    await until(async () => {
      const step = (await run(workflows.run(loopRun))).steps.find(
        (candidate) => candidate.nodeId === nodeId && candidate.status === "approval",
      );
      stepId = step?.id ?? "";
      return step !== undefined;
    });
    await run(workflows.decide({ stepId, approved }));
  };
  for (const pass of [1, 2]) {
    await decideAt("review", true);
    await decideAt("again", true);
    await until(() => loopPosts().length === pass);
  }
  await decideAt("review", false);
  const loopEnd = await runEnd(loopRun);
  check(
    "each pass of a loop posts its own comment",
    loopEnd.status === "stopped" && loopPosts().length === 2 && loopPosts().every((change) => change.body === SAY),
    { loopEnd, posts: loopPosts() },
  );

  const label = await run(
    workflows.create({
      title: "Label",
      graph: lineOf("acme/label", [githubOutput({ action: "label.add", labelsFrom: "agent" })]),
    }),
  );
  const labelRun = await startedRun(label.summary.id, comment("acme/label", 7, "ana").body);
  const labelEnd = await runEnd(labelRun);
  const labelled = changes.find((change) => change.repository === "acme/label");
  check(
    '"Agent chooses" adds only the repository\'s own label, as the repository names it',
    labelEnd.status === "done" && labelled?.labels.join() === "Bug",
    { labelEnd, labelled },
  );

  const slow = await run(
    workflows.create({ title: "Slow", graph: saying(lineOf("acme/slow", [githubOutput({ action: "comment" })])) }),
  );
  const slowLabel = await run(
    workflows.create({
      title: "Slow label",
      graph: lineOf("acme/slowlabel", [githubOutput({ action: "label.add", labels: "docs" })]),
    }),
  );
  let slowCalled = changeMade();
  const slowRun = await startedRun(slow.summary.id, comment("acme/slow", 8, "ana").body);
  await slowCalled;
  slowCalled = changeMade();
  const slowLabelRun = await startedRun(slowLabel.summary.id, comment("acme/slowlabel", 8, "ana").body);
  await slowCalled;
  // The app stops while GitHub has the comment, and starts again.
  await Effect.runPromise(workflows.close());
  service = null;
  workflows = await Effect.runPromise(createWorkflows(dependencies));
  service = workflows;
  await run(workflows.sweep());
  const slowEnd = await runEnd(slowRun);
  const slowStep = await outputStep(slowRun);
  check(
    "a restart does not post a comment that was on its way again",
    slowEnd.status === "failed" &&
      changes.filter((change) => change.repository === "acme/slow").length === 1 &&
      slowStep?.error === sourceText("error.workflow.githubUncertain"),
    { slowEnd, slowStep },
  );
  const slowLabelEnd = await runEnd(slowLabelRun);
  check(
    "a restart sends a label that was on its way again",
    slowLabelEnd.status === "done" && changes.filter((change) => change.repository === "acme/slowlabel").length === 2,
    { slowLabelEnd, changes },
  );

  const last = await run(
    workflows.create({
      title: "Last",
      graph: saying(lineOf("acme/last", [githubOutput({ action: "comment" })], "notBot")),
    }),
  );
  const lastDetail = await run(
    workflows.githubLastEvent({ workflowId: last.summary.id, nodeId: "trigger", requestId: "last-1" }),
  );
  const lastEnd = await runEnd(lastDetail.run.id);
  const lastItem = dependencies.github.runItem(lastDetail.run.id);
  check(
    '"Run with last event" starts a run with the newest item that the filters let through',
    lastEnd.status === "done" && lastItem?.number === 12,
    { lastEnd, lastItem },
  );

  report.history = await history(queue.summary.id);
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  if (service) await Effect.runPromise(service.close());
  database.close();
  await rm(directory, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `${report.passed ? "passed" : "failed"}: ${report.checks.length} checks; ${join(OUT, "report.json")}\n`,
  );
  if (report.failure) process.stderr.write(`${report.failure}\n`);
}
