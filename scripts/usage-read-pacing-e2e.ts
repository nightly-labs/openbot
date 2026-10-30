// Checks how often the account usage is read. Runs the real agent service on a temporary profile with a
// fake Codex app-server that logs each `account/rateLimits/read` and answers it with an error, as HTTP 429,
// while a flag file exists. The service clock moves forward in place of a wait. Cases: polls from many
// views at once share one read; a poll within four minutes of a read reads nothing; a failed read keeps
// the last reading and the next read waits 5, 10, 20 and 40 minutes, up to an hour; a read that succeeds
// ends the wait; a window that had reset before the read does not start a read at each poll and stays on the
// rail; after a credential change, no view shows the old credential's reading.
// `bun scripts/usage-read-pacing-e2e.ts`. Writes .openbot-build/usage-read-pacing-e2e/report.json.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/usage-read-pacing-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-usage-pacing-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const readLog = join(root, "reads.jsonl");
const failFlag = join(root, "fail");
const pastFlag = join(root, "past");

process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
mkdirSync(home, { recursive: true });

// The service reads the clock through `Date.now`. Moving it is the wait for the next read.
const realNow = Date.now.bind(Date);
let skewMs = 0;
Date.now = () => realNow() + skewMs;
const MINUTE = 60_000;

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

/** A Codex app-server with the methods that a start and a usage read call. Each reading has a new percent. */
const FAKE_CODEX = `#!/usr/bin/env node
const { appendFileSync, existsSync } = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
// Far after any time that the moved clock reaches, so no window resets during the check.
const resetsAt = Math.floor(Date.now() / 1000) + 30 * 86400;
let buffer = "";
let reads = 0;
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const answer = (message) => {
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
    case "account/rateLimits/read": {
      const failed = existsSync(${JSON.stringify(failFlag)});
      appendFileSync(${JSON.stringify(readLog)}, JSON.stringify({ pid: process.pid, failed }) + "\\n");
      if (failed) return write({ id: message.id, error: { code: -32000, message: "HTTP 429 Too Many Requests" } });
      reads += 1;
      return write({ id: message.id, result: {
        // A window that has not rolled yet: its reset time is already over when the reading is sent.
        rateLimits: { limitId: "codex", primary: { usedPercent: reads, windowDurationMins: 300, resetsAt: existsSync(${JSON.stringify(pastFlag)}) ? 1 : resetsAt }, secondary: null },
        rateLimitsByLimitId: null,
      } });
    }
    case "model/list": return write({ id: message.id, result: { data: [{ model: "gpt-6-luna", displayName: "GPT-6 Luna" }] } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": return write({ id: message.id, result: config });
    case "config/batchWrite": return write({ id: message.id, result: {} });
    default:
      return write({ id: message.id, error: { code: -32601, message: "Method not found: " + message.method } });
  }
};
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line) {
      const message = JSON.parse(line);
      if (message.method && message.id !== undefined) answer(message);
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

interface CaseReport {
  name: string;
  details: unknown;
  passed: boolean;
}

const report: { cases: CaseReport[]; passed: boolean; error?: string } = { cases: [], passed: false };

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
};

/** Waits for a state of the service, on the real clock. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = realNow() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (realNow() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

function reads(): { pid: number; failed: boolean }[] {
  if (!existsSync(readLog)) return [];
  return readFileSync(readLog, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "codex",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
});

/** One dock poll: the percent of the Codex reading that it answers, or null with no reading. */
async function poll(): Promise<number | null> {
  const usage = await runCauseEffect(agents.getUsage());
  return usage.limits.find((limit) => limit.id === "codex")?.primary?.usedPercent ?? null;
}

/** Moves the clock, polls, and answers how many reads the poll sent. */
async function pollAfter(minutes: number): Promise<{ sent: number; percent: number | null }> {
  skewMs += minutes * MINUTE;
  const before = reads().length;
  const percent = await poll();
  return { sent: reads().length - before, percent };
}

try {
  await runCauseEffect(agents.initialize());
  // The first poll starts Codex. Its start reads the usage once, and the poll reads it once.
  const first = await poll();
  await waitFor("the reads of the start", () => reads().length >= 2);
  assert.ok(first !== null, "The first poll has a reading.");
  report.cases.push({ name: "the first poll reads", details: { first, reads: reads().length }, passed: true });

  skewMs += 4 * MINUTE + 1_000;
  const before = reads().length;
  const together = await Promise.all(Array.from({ length: 5 }, () => poll()));
  assert.equal(reads().length - before, 1, "Five polls at once send one read.");
  assert.ok(
    together.every((percent) => percent === together[0] && percent !== null),
    `Each poll has the same reading: ${together.join(", ")}`,
  );
  report.cases.push({ name: "polls at once share one read", details: { together }, passed: true });

  const soon = await pollAfter(1);
  assert.equal(soon.sent, 0, "A poll one minute after a read sends none.");
  assert.equal(soon.percent, together[0], "It answers with the last reading.");
  report.cases.push({ name: "a poll within the interval reads nothing", details: soon, passed: true });

  writeFileSync(failFlag, "");
  const failed = await pollAfter(4);
  assert.equal(failed.sent, 1, "The poll after the interval reads.");
  assert.equal(failed.percent, together[0], "A failed read keeps the last reading.");
  const waits: { minutes: number; early: number; due: number }[] = [];
  // After each failure, a poll one minute before the wait ends sends nothing, and one after it reads.
  for (const minutes of [5, 10, 20, 40, 60, 60]) {
    const early = await pollAfter(minutes - 1);
    const due = await pollAfter(1);
    assert.equal(early.sent, 0, `No read during the ${minutes} minute wait.`);
    assert.equal(due.sent, 1, `A read after the ${minutes} minute wait.`);
    assert.equal(due.percent, together[0], "Each failed read keeps the last reading.");
    waits.push({ minutes, early: early.sent, due: due.sent });
  }
  assert.ok(
    reads()
      .slice(-7)
      .every((read) => read.failed),
    "The reads during the waits failed.",
  );
  report.cases.push({ name: "failed reads wait longer each time, up to an hour", details: { waits }, passed: true });

  await rm(failFlag);
  const recovered = await pollAfter(61);
  assert.equal(recovered.sent, 1);
  assert.ok(
    recovered.percent !== null && recovered.percent > (together[0] ?? 0),
    "A read that succeeds shows a new reading.",
  );
  const next = await pollAfter(4 + 1 / 60);
  assert.equal(next.sent, 1, "After a success, the interval is four minutes again.");
  report.cases.push({ name: "a read that succeeds ends the wait", details: { recovered, next }, passed: true });

  writeFileSync(pastFlag, "");
  const past = await pollAfter(4 + 1 / 60);
  const afterPast = await pollAfter(1);
  await rm(pastFlag);
  assert.equal(past.sent, 1);
  assert.equal(afterPast.sent, 0, "A window that had reset before the read does not ask for a read at each poll.");
  assert.equal(afterPast.percent, past.percent, "The reading stays on the rail until the next read.");
  const rolled = await pollAfter(4 + 1 / 60);
  assert.equal(rolled.sent, 1);
  report.cases.push({
    name: "a window that reset before the read does not start a read at each poll",
    details: { past, afterPast, rolled },
    passed: true,
  });

  const pid = reads().at(-1)?.pid;
  const oldPercent = (await poll()) ?? 0;
  // The new credential's first reads fail: no view shows the old credential's reading in its place.
  writeFileSync(failFlag, "");
  await runCauseEffect(agents.changeProviderCredential("codex", () => Effect.void));
  await waitFor("the read of the new process", () => reads().some((read) => read.pid !== pid));
  const failedAfterChange = await poll();
  assert.equal(
    failedAfterChange,
    null,
    `A failed read after a credential change shows no old reading: ${failedAfterChange}`,
  );
  await rm(failFlag);
  const changed = await pollAfter(5 + 1 / 60);
  const newReads = reads().filter((read) => read.pid !== pid);
  assert.equal(changed.sent, 1, "After the wait, the new credential is read.");
  assert.ok(
    changed.percent !== null && changed.percent < oldPercent,
    `The new credential's reading shows: ${changed.percent}, before ${oldPercent}`,
  );
  report.cases.push({
    name: "after a credential change, no view shows the old credential's reading",
    details: { oldPercent, failedAfterChange, changed, newReads: newReads.length },
    passed: true,
  });
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  Date.now = realNow;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
