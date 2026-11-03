// Checks that a GitHub output keeps the files of the Discord mention that started its run. It runs the
// real SQLite, the real workflow service and the real GitHub REST client on a temporary profile. Only
// GitHub's API and Discord's CDN are stand-ins, so no Signal, provider, account or network is started.
// The trigger step gives agents the files; a new issue links the files that the client copied to the
// `openbot-attachments` branch (an orphan commit with `[skip ci]`), and a file that is too large or that
// does not download keeps its Discord link; a second mention builds on the branch and tries once more
// when another output moved it; a file that GitHub refuses keeps its Discord link, the other files still
// copy, and the issue is still made; a mention with no files makes no Git call.
//
// Run: bun scripts/discord-github-files-e2e.ts
// Writes .openbot-build/discord-github-files-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { WorkflowGraph, WorkflowNode, WorkflowRunDetail } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { MessagingDiscordMention } from "../src/backend/messaging/messaging-threads";
import { type InboundFile, MessagingAdapterError } from "../src/backend/messaging/messaging-types";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { WorkflowGitHubStore } from "../src/backend/workflows/workflow-github-store";
import { WorkflowRunStore } from "../src/backend/workflows/workflow-run-store";
import { WorkflowStore } from "../src/backend/workflows/workflow-store";
import { workflowScheduleDueAt } from "../src/backend/workflows/workflow-triggers";
import { createWorkflows, type WorkflowsHandle } from "../src/backend/workflows/workflows";
import { createGitHubRest } from "../src/main/github-rest";

const OUT = resolve(import.meta.dirname, "../.openbot-build/discord-github-files-e2e");
const CONNECTION = "messaging-discord-files-e2e";
const CHANNEL = "110000000000000001";
const REPOSITORY = "acme/files";
const BRANCH = "openbot-attachments";
const CDN = "https://cdn.discordapp.com/attachments/110000000000000001";
const WAIT_MS = 5_000;

interface GitCall {
  method: string;
  path: string;
  body: DynamicRecord | null;
}

interface Report {
  checks: string[];
  /** The Git and issue calls, without the file bytes. */
  calls: { method: string; path: string; status: number }[];
  issues: { title: string; body: string }[];
  passed: boolean;
  failure?: string;
}

const report: Report = { checks: [], calls: [], issues: [], passed: false };
const check = (name: string, ok: boolean, detail?: unknown) => {
  assert.ok(ok, `${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  report.checks.push(name);
};

// The fake Discord CDN: the bytes of each file it has. Another address does not download.
const cdnFiles = new Map<string, Uint8Array>();
const cdnFile = (name: string, mimeType: string, bytes: Uint8Array | null, size = bytes?.byteLength ?? 1) => {
  const id = `${200000000000000000n + BigInt(cdnFiles.size + 1)}`;
  const url = `${CDN}/${id}/${encodeURIComponent(name)}?ex=6800&is=6700&hm=abc`;
  if (bytes) cdnFiles.set(url, bytes);
  return { id, name, mimeType, size, url } satisfies InboundFile;
};

// The fake GitHub API: one repository with no `openbot-attachments` branch at the start.
const calls: GitCall[] = [];
const blobs = new Map<string, string>();
const commits = new Map<string, { tree: string; message: string; parents: string[] }>();
let branchHead: string | null = null;
let nextSha = 0;
/** The next branch update is refused, as when another output moved the branch first. */
let refuseNextUpdate = false;
/** Blobs are refused, as when the app lost access to the repository's contents. */
/** The number of next blobs that GitHub refuses. */
let refuseBlobs = 0;
let issueNumber = 0;

const sha = (kind: string) => {
  nextSha += 1;
  return `${kind}${nextSha.toString().padStart(4, "0")}`;
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function githubFetch(url: string, init: RequestInit): Promise<Response> {
  const method = init.method ?? "GET";
  const path = new URL(url).pathname.replace(`/repos/${REPOSITORY}`, "");
  const parsed = typeof init.body === "string" ? JSON.parse(init.body) : null;
  const body = isDynamicRecord(parsed) ? parsed : null;
  calls.push({ method, path, body });
  const response = answer(method, path, body);
  report.calls.push({ method, path, status: response.status });
  return response;
}

function answer(method: string, path: string, body: DynamicRecord | null): Response {
  const route = `${method} ${path}`;
  if (route === `GET /git/ref/heads/${BRANCH}`)
    return branchHead ? json(200, { ref: `refs/heads/${BRANCH}`, object: { sha: branchHead } }) : json(404, {});
  if (method === "GET" && path.startsWith("/git/commits/")) {
    const commitSha = path.slice("/git/commits/".length);
    const commit = commits.get(commitSha);
    return commit ? json(200, { sha: commitSha, tree: { sha: commit.tree } }) : json(404, {});
  }
  if (route === "POST /git/blobs") {
    if (refuseBlobs > 0) {
      refuseBlobs -= 1;
      return json(500, { message: "Server Error" });
    }
    const blobSha = sha("blob");
    blobs.set(blobSha, String(body?.content));
    return json(201, { sha: blobSha });
  }
  if (route === "POST /git/trees") return json(201, { sha: sha("tree") });
  if (route === "POST /git/commits") {
    const commitSha = sha("commit");
    commits.set(commitSha, {
      tree: String(body?.tree),
      message: String(body?.message),
      parents: Array.isArray(body?.parents) ? body.parents.map(String) : [],
    });
    return json(201, { sha: commitSha });
  }
  if (route === "POST /git/refs") {
    if (branchHead) return json(422, { message: "Reference already exists" });
    branchHead = String(body?.sha);
    return json(201, { ref: `refs/heads/${BRANCH}`, object: { sha: branchHead } });
  }
  if (route === `PATCH /git/refs/heads/${BRANCH}`) {
    const next = String(body?.sha);
    if (refuseNextUpdate || !commits.get(next)?.parents.includes(branchHead ?? "")) {
      refuseNextUpdate = false;
      // Another output moved the branch in between.
      const moved = sha("commit");
      commits.set(moved, { tree: sha("tree"), message: "another output", parents: branchHead ? [branchHead] : [] });
      branchHead = moved;
      return json(422, { message: "Update is not a fast forward" });
    }
    branchHead = next;
    return json(200, { ref: `refs/heads/${BRANCH}`, object: { sha: next } });
  }
  if (route === "POST /issues") {
    issueNumber += 1;
    report.issues.push({ title: String(body?.title), body: String(body?.body) });
    return json(201, { number: issueNumber, html_url: `https://github.com/${REPOSITORY}/issues/${issueNumber}` });
  }
  return json(404, { message: "Not Found" });
}

const githubApi = createGitHubRest({
  fetch: githubFetch,
  tokens: () => Effect.succeed({ user: "user-token", bot: "app-token" }),
  download: (url, maxBytes) =>
    Effect.suspend(() => {
      const bytes = cdnFiles.get(url);
      if (!bytes) return Effect.fail(new MessagingAdapterError({ cause: new Error("The file is gone.") }));
      if (bytes.byteLength > maxBytes)
        return Effect.fail(new MessagingAdapterError({ cause: new Error("The file is too large.") }));
      return Effect.succeed(bytes);
    }),
});

const node = (id: string, kind: WorkflowNode["kind"], fields: WorkflowNode["fields"], x: number): WorkflowNode => ({
  id,
  kind,
  at: { x, y: 0 },
  fields,
});
/** A Discord mention makes an issue with the text of a prompt step. */
const SAY = "A person reported this in Discord.";
const graph: WorkflowGraph = {
  nodes: [
    node(
      "trigger",
      "trigger",
      { trigger: "discord", event: "mention", connectionId: CONNECTION, placeId: "", text: "bug" },
      0,
    ),
    node("say", "prompt", { text: SAY }, 0),
    node(
      "out",
      "output",
      { target: "github", repository: REPOSITORY, action: "issue.create", title: "From Discord" },
      300,
    ),
  ],
  edges: [
    { id: "to-out", from: "trigger", to: "out", type: "text" },
    { id: "say-out", from: "say", to: "out", type: "text" },
  ],
  strokes: [],
};

let nextMessage = 700000000000000000n;
const mentionOf = (text: string, files: InboundFile[]): MessagingDiscordMention => {
  nextMessage += 1n;
  return {
    connectionId: CONNECTION,
    serverName: "Nightly",
    channelId: CHANNEL,
    channelName: "general",
    messageId: nextMessage.toString(),
    authorId: "500000000000000002",
    authorName: "Bob",
    authorRoleIds: [],
    text,
    files,
    receivedAt: new Date().toISOString(),
  };
};

const directory = await mkdtemp(join(tmpdir(), "openbot-discord-github-files-"));
const database = new OpenBotDatabase(directory);
let service: WorkflowsHandle | null = null;

/** Waits for the newest run of a workflow to end. */
async function runEnded(workflows: WorkflowsHandle, workflowId: string, after: string | null) {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const newest = (await runCauseEffect(workflows.runs({ workflowId, limit: 1 }))).runs[0];
    if (newest && newest.run.id !== after && newest.run.status !== "running" && newest.run.status !== "stopping")
      return newest;
    if (Date.now() > deadline) throw new Error(`The run did not end: ${JSON.stringify(newest?.run)}`);
    await new Promise((done) => setImmediate(done));
  }
}
const stepOf = (detail: WorkflowRunDetail, nodeId: string) => detail.steps.find((step) => step.nodeId === nodeId);
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const branchLink = (commit: string, path: string) => `https://github.com/${REPOSITORY}/blob/${commit}/${path}?raw=true`;

try {
  await Effect.runPromise(database.initialize());
  const now = new Date().toISOString();
  database.connection
    .prepare(
      `INSERT INTO projection_messaging_connections
         (connection_id, platform, workspace_id, workspace_name, enabled, created_at, updated_at)
       VALUES (?, 'discord', '100000000000000001', 'Nightly', 1, ?, ?)`,
    )
    .run(CONNECTION, now, now);
  service = await Effect.runPromise(
    createWorkflows({
      store: new WorkflowStore({ database, nextDueAt: workflowScheduleDueAt(() => "UTC") }),
      runs: new WorkflowRunStore({ database }),
      github: new WorkflowGitHubStore({ database }),
      githubApp: () => "openbotgit",
      githubApi,
      delivery: () => null,
      turnAnswer: () => null,
      sendHandoff: () => Effect.fail({ cause: new Error("No agent step runs in this test.") }),
      stopDelivery: () => Effect.void,
      generateText: () => Effect.fail({ message: "No model step runs in this test." }),
      notify: () => {},
      connectionOn: (connectionId) => connectionId === CONNECTION,
      post: () => Effect.die(new Error("No output posts in this test.")),
      discordSend: () => Effect.die(new Error("No Discord output runs in this test.")),
      changed: () => {},
      rearm: () => {},
      timezone: () => "UTC",
    }),
  );
  const workflows = service;
  const created = await runCauseEffect(workflows.create({ title: "Discord bugs" }));
  const saved = await runCauseEffect(
    workflows.saveGraph({ workflowId: created.summary.id, baseRevision: created.revision, graph }),
  );
  assert.ok(saved.ok);
  const workflowId = created.summary.id;

  // 1. Two files copy; a large file and a file that does not download keep their Discord links.
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const log = new TextEncoder().encode("line 1\nline 2\n");
  const shot = cdnFile("screen shot [1].png", "image/png", png);
  const notes = cdnFile("notes.txt", "text/plain", log);
  const video = cdnFile("crash.mov", "video/quicktime", null, 30 * 1024 * 1024);
  const gone = cdnFile("gone.png", "image/png", null);
  const first = mentionOf("bug: the app stops", [shot, notes, video, gone]);
  check("a mention with files starts a run", (await runCauseEffect(workflows.receiveDiscord(first))) === "started");
  const firstRun = await runEnded(workflows, workflowId, null);
  check("the run ends done", stepOf(firstRun, "out")?.status === "done", firstRun.steps);
  const trigger = stepOf(firstRun, "trigger")?.output ?? "";
  check(
    "the trigger step gives the steps after it the name, type, size and address of each file",
    [shot, notes, video, gone].every(
      (file) =>
        trigger.includes(JSON.stringify(file.url)) &&
        trigger.includes(`"contentType":${JSON.stringify(file.mimeType)}`) &&
        trigger.includes(`"size":${file.size}`),
    ),
  );
  const firstCommit = branchHead ?? "";
  const folder = `discord/${first.messageId}`;
  check(
    "the files go to a new branch with no parent, which starts no CI",
    commits.get(firstCommit)?.parents.length === 0 &&
      Boolean(commits.get(firstCommit)?.message.includes("[skip ci]")) &&
      calls.some((call) => call.method === "POST" && call.path === "/git/refs"),
    [...commits.entries()],
  );
  const firstTree = calls.find((call) => call.method === "POST" && call.path === "/git/trees")?.body;
  const entries = Array.isArray(firstTree?.tree) ? firstTree.tree : [];
  check(
    "only the two files that downloaded are in the tree, under the message's folder, with safe names",
    entries.length === 2 &&
      JSON.stringify(entries.map((entry) => entry.path)) ===
        JSON.stringify([`${folder}/1-screen-shot-1-.png`, `${folder}/2-notes.txt`]) &&
      firstTree?.base_tree === undefined,
    entries,
  );
  check(
    "the blobs keep the bytes of the files",
    JSON.stringify([...blobs.values()]) === JSON.stringify([base64(png), base64(log)]),
  );
  const firstIssue = report.issues[0]?.body ?? "";
  check(
    "the issue keeps the text and shows the copied image from the branch",
    firstIssue.startsWith(SAY) &&
      firstIssue.includes(`![screen shot \\[1\\].png](<${branchLink(firstCommit, `${folder}/1-screen-shot-1-.png`)}>)`),
    firstIssue,
  );
  check(
    "the issue links the copied text file from the branch",
    firstIssue.includes(`[notes.txt](<${branchLink(firstCommit, `${folder}/2-notes.txt`)}>)`) &&
      !firstIssue.includes("![notes.txt]"),
    firstIssue,
  );
  check(
    "a file that is too large, or that does not download, keeps its Discord link",
    firstIssue.includes(`[crash.mov](<${video.url}>)`) && firstIssue.includes(`![gone.png](<${gone.url}>)`),
    firstIssue,
  );
  check(
    "the issue does not keep the trigger's raw event",
    !firstIssue.includes("discord.mention") && !firstIssue.includes('"authorId"'),
    firstIssue,
  );

  // 2. Another output moves the branch between the read and the update: the client builds on its commit.
  refuseNextUpdate = true;
  const second = mentionOf("bug: one more", [cdnFile("trace.log", "text/plain", new TextEncoder().encode("trace"))]);
  check("a second mention starts a run", (await runCauseEffect(workflows.receiveDiscord(second))) === "started");
  const secondRun = await runEnded(workflows, workflowId, firstRun.run.id);
  check("the second run ends done", stepOf(secondRun, "out")?.status === "done", secondRun.steps);
  const secondCommit = branchHead ?? "";
  const updates = calls.filter((call) => call.method === "PATCH");
  check(
    "a refused update is tried once more on the new head of the branch, and does not force",
    updates.length === 2 &&
      updates.every((call) => call.body?.force === false) &&
      commits.get(secondCommit)?.parents.length === 1 &&
      commits.get(secondCommit)?.parents[0] !== firstCommit,
    { updates, head: commits.get(secondCommit) },
  );
  check(
    "the second issue links the file in the commit that the branch keeps",
    Boolean(
      report.issues[1]?.body.includes(
        `[trace.log](<${branchLink(secondCommit, `discord/${second.messageId}/1-trace.log`)}>)`,
      ),
    ),
    report.issues[1],
  );

  // 3. GitHub refuses one file: that file keeps its Discord link, and the other file still copies.
  refuseBlobs = 1;
  const refused = cdnFile("photo.jpg", "image/jpeg", new Uint8Array([0xff, 0xd8, 0xff]));
  const kept = cdnFile("steps.txt", "text/plain", new TextEncoder().encode("steps"));
  const third = mentionOf("bug: refused copy", [refused, kept]);
  check("a third mention starts a run", (await runCauseEffect(workflows.receiveDiscord(third))) === "started");
  const thirdRun = await runEnded(workflows, workflowId, secondRun.run.id);
  const thirdCommit = branchHead ?? "";
  check(
    "a refused file does not stop the issue or the other files: it keeps its Discord link",
    stepOf(thirdRun, "out")?.status === "done" &&
      thirdCommit !== secondCommit &&
      Boolean(report.issues[2]?.body.includes(`![photo.jpg](<${refused.url}>)`)) &&
      Boolean(
        report.issues[2]?.body.includes(
          `[steps.txt](<${branchLink(thirdCommit, `discord/${third.messageId}/2-steps.txt`)}>)`,
        ),
      ),
    { steps: thirdRun.steps, issue: report.issues[2] },
  );
  refuseBlobs = 0;

  // 4. A mention with no files makes no Git call.
  const before = calls.length;
  check(
    "a mention with no files starts a run",
    (await runCauseEffect(workflows.receiveDiscord(mentionOf("bug: no files", [])))) === "started",
  );
  const fourthRun = await runEnded(workflows, workflowId, thirdRun.run.id);
  const after = calls.slice(before);
  check(
    "a mention with no files makes only the issue, with only the text",
    stepOf(fourthRun, "out")?.status === "done" &&
      after.length === 1 &&
      after[0]?.path === "/issues" &&
      report.issues[3]?.body === SAY,
    { after, issue: report.issues[3] },
  );

  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  if (service) await Effect.runPromise(service.close()).catch(() => {});
  database.close();
  await rm(directory, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${report.passed ? "passed" : "FAILED"}: ${report.checks.length} checks; ${OUT}/report.json\n`);
  if (report.failure) process.stderr.write(`${report.failure}\n`);
}
