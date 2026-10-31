// Checks the GitHub triggers of workflows on the real SQLite and the real workflow service, on a
// temporary profile. The events go through `receiveGitHubDelivery`, as the ingress socket gives them:
// a comment starts a run; a second comment on the same issue waits and starts when the first run ends;
// a comment on another issue runs at the same time; the same delivery again records nothing; a bot
// that is not OpenBot's is refused by "not a bot"; an echo of the workflow's own comment is skipped
// (`self`); the fourth run of a chain that OpenBot's bot caused on one issue is skipped (`chain`); an
// event of a repository that no trigger watches gets 404 and a body that is not JSON gets 400; two close
// times offline are one gap. No app, provider, account, Signal or network is started.
//
// Run: bun scripts/github-workflow-e2e.ts
// Writes .openbot-build/github-workflow-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { WorkflowGitHubHistory, WorkflowGraph } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { WorkflowGitHubStore } from "../src/backend/workflows/workflow-github-store";
import { WorkflowRunStore } from "../src/backend/workflows/workflow-run-store";
import { WorkflowStore } from "../src/backend/workflows/workflow-store";
import { workflowScheduleDueAt } from "../src/backend/workflows/workflow-triggers";
import { createWorkflows, type WorkflowsHandle } from "../src/backend/workflows/workflows";
import { receiveGitHubDelivery } from "../src/main/github-relay";

const OUT = resolve(import.meta.dirname, "../.openbot-build/github-workflow-e2e");
const BOT = "openbotgit";

interface Report {
  checks: string[];
  watched?: string[];
  history?: WorkflowGitHubHistory;
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
  const workflows = await Effect.runPromise(
    createWorkflows({
      store: new WorkflowStore({ database, nextDueAt: workflowScheduleDueAt(() => "UTC") }),
      runs: new WorkflowRunStore({ database }),
      github: new WorkflowGitHubStore({ database }),
      githubApp: () => BOT,
      watchGitHub: (repositories) => watched.push(repositories),
      delivery: () => null,
      turnAnswer: () => null,
      sendHandoff: () => Effect.fail({ cause: new Error("No agent step runs in this test.") }),
      stopDelivery: () => Effect.void,
      generateText: () => Effect.fail({ message: "No model step runs in this test." }),
      notify: () => {},
      connectionOn: () => false,
      post: () => Effect.die(new Error("No output posts in this test.")),
      changed: () => {},
      rearm: () => {},
      timezone: () => "UTC",
    }),
  );
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
  report.watched = watched.at(-1);
  check(
    "the saved triggers set the watched repositories",
    [...(watched.at(-1) ?? [])].sort().join() === "acme/app,acme/chain",
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
