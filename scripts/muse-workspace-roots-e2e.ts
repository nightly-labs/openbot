// Drives MuseAgentClient and the installed SDK over real child stdio for issues #2346 and #3356.
// bun scripts/muse-workspace-roots-e2e.ts --phase=before|after
// Phase changes only the report folder. Both phases require unique, canonical workspace roots.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, toNamespacedPath } from "node:path";
import { EXPECTED_SCHEMA_FINGERPRINT } from "@muse-code/sdk";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MuseAgentClient } from "../src/backend/muse-client";
import { type AppServerNotification, getString, isRecord } from "../src/backend/protocol";

const phase = process.argv.slice(2)[0];
assert.ok(
  process.argv.length === 3 && (phase === "--phase=before" || phase === "--phase=after"),
  "Use --phase=before or --phase=after.",
);
// Keep artifacts inside the bounded scripts workspace, independent of the launch directory.
const out = resolve(import.meta.dirname, ".openbot-build/muse-workspace-roots-e2e", phase.slice(8));
const deadlineMs = 8_000;

// This fixture implements only the MSP surface used here. Unknown requests fail closed.
// The SDK owns spawn, NDJSON framing, command IDs, handshake, and process shutdown.
const fixture = `#!${process.execPath}
const fs = require("node:fs");
const readline = require("node:readline");
const path = require("node:path");
const log = (entry) => fs.appendFileSync(process.env.FIXTURE_LOG,
  JSON.stringify({ pid: process.pid, ...entry }) + "\\n");
const send = (entry) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...entry }) + "\\n");
const timer = setTimeout(() => { log({ event: "deadline" }); process.exit(2); }, 45000);
let initialized = false;
let sessionId;
let completedItem;
log({ event: "spawn", argv: process.argv.slice(2) });
const lines = readline.createInterface({ input: process.stdin });
lines.on("close", () => {
  clearTimeout(timer);
  log({ event: "eof" });
});
lines.on("line", (line) => {
  const message = JSON.parse(line);
  const p = message.params || {};
  log({ event: "request", method: message.method, params: p });
  const result = (value) => send({ id: message.id, result: value });
  const reject = (text) => {
    log({ event: "rejected", method: message.method, reason: text });
    send({ id: message.id, error: { code: -32602, message: text, data: { kind: "invalidParams" } } });
  };
  if (message.method === "initialize") {
    result({ experimentalApi: false, grantedCapabilities: ["sessionMcp"],
      museHome: process.env.HOME, platformFamily: "unix", platformOs: process.platform,
      schema: { version: 1, fingerprint: process.env.FIXTURE_FINGERPRINT },
      serverInfo: { name: "workspace-roots-fixture", version: "1" },
      sessionDurability: "durable", userAgent: "local-e2e" });
    return;
  }
  if (message.method === "initialized") { initialized = true; return; }
  if (!initialized) return reject("initialized handshake required");
  if (message.method === "session/start" || message.method === "session/resume") {
    const file = path.join(process.env.HOME, p.sessionId + ".json");
    if (message.method === "session/start") {
      fs.writeFileSync(file, JSON.stringify({ sessionId: p.sessionId, workspaceRoot: p.workspaceRoot }));
    } else if (!fs.existsSync(file) || JSON.parse(fs.readFileSync(file)).sessionId !== p.sessionId) {
      return reject("saved session required");
    }
    sessionId = p.sessionId;
    result({ session: { sessionId } });
    return;
  }
  if (message.method === "session/read") {
    if (p.sessionId !== sessionId) return reject("session mismatch");
    if (p.excludeItems !== false || !completedItem) return reject("completed turn history required");
    result({ session: { sessionId }, history: {
      mode: "inline", items: [completedItem], snapshot: null
    }, pendingRequests: [], viewCursor: "1" });
    return;
  }
  if (message.method !== "turn/start") return reject("unexpected method: " + message.method);
  if (p.sessionId !== sessionId) return reject("session mismatch");
  if (!Array.isArray(p.workspaceRoots) || !p.workspaceRoots.every((root) => typeof root === "string")) {
    return reject("workspaceRoots must be strings");
  }
  if (new Set(p.workspaceRoots).size !== p.workspaceRoots.length) {
    return reject("duplicate workspaceRoots");
  }
  // As the Muse host: the real path, in the verbatim form on Windows.
  const canonical = (root) => {
    try { return path.toNamespacedPath(fs.realpathSync.native(root)); } catch { return null; }
  };
  if (!p.workspaceRoots.every((root) => canonical(root) === root)) {
    return reject("expected a canonical path");
  }
  const turnId = p.commandId;
  completedItem = {
    itemId: turnId + "-reply", turnId, kind: "agentMessage", revision: 1, status: "completed", text: "OK"
  };
  log({ event: "accepted", method: message.method, turnId });
  result({ commandId: turnId, status: "accepted", turnId });
  send({ method: "item/completed", params: { sessionId, item: completedItem } });
  send({ method: "turn/completed", params: { sessionId, turnId, terminal: "completed" } });
});
`;

interface Entry {
  pid: number;
  event: string;
  method?: string;
  params?: { workspaceRoots?: string[] };
  reason?: string;
}

interface CaseResult {
  name: string;
  operation: string;
  inputRoots: string[];
  expectedRoots: string[];
  observedRoots?: unknown;
  clientResult?: unknown;
  clientError?: string;
  notifications: AppServerNotification[];
  requests: Entry[];
  failures: string[];
  cleanup: { clientStopped: boolean; children: { pid: number; stopped: boolean; eof: boolean }[] };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function decodeThreadId(value: unknown): string {
  assert.ok(isRecord(value), "The client returns a thread response.");
  const id = getString(value.thread, "id");
  assert.ok(id, "The client returns a thread ID.");
  return id;
}

async function bounded<T>(promise: Promise<T>, label: string, ms = deadlineMs): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: deadline exceeded`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isRecord(error) && error.code === "ESRCH") return false;
    throw error;
  }
}

async function entries(file: string): Promise<Entry[]> {
  return (await readFile(file, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line: string) => JSON.parse(line));
}

interface Report {
  phase: string;
  passed: boolean;
  sourceSha256: Record<string, string>;
  sdkVersion: string;
  cases: CaseResult[];
  failures: string[];
  failureCount: number;
  tempRemoved: boolean;
}

const report: Report = {
  phase: phase.slice(8),
  passed: false,
  sourceSha256: {},
  sdkVersion: "",
  cases: [],
  failures: [],
  failureCount: 0,
  tempRemoved: false,
};
let root: string | undefined;

try {
  for (const file of ["../src/backend/muse-client.ts", "muse-workspace-roots-e2e.ts"]) {
    report.sourceSha256[file] = createHash("sha256")
      .update(await readFile(resolve(import.meta.dirname, file)))
      .digest("hex");
  }
  const sdk = JSON.parse(
    await readFile(resolve(import.meta.dirname, "../node_modules/@muse-code/sdk/package.json"), "utf8"),
  );
  report.sdkVersion = sdk.version;
  root = await mkdtemp(join(tmpdir(), "openbot-muse-roots-e2e-"));
  const executable = join(root, "fixture.cjs");
  await writeFile(executable, fixture);
  await chmod(executable, 0o700);
  const cwd = join(root, "workspace");
  const shared = join(root, "shared");
  const home = join(root, "home");
  for (const directory of [cwd, shared, home]) await mkdir(directory);
  // A junction needs no Windows privilege. Other platforms ignore the type.
  const linkedCwd = join(root, "linked-workspace");
  const linkedShared = join(root, "linked-shared");
  await symlink(cwd, linkedCwd, "junction");
  await symlink(shared, linkedShared, "junction");
  const realCwd = toNamespacedPath(await realpath(cwd));
  const realShared = toNamespacedPath(await realpath(shared));

  for (const scenario of [
    { name: "control", cwd, roots: [], expected: [realCwd] },
    { name: "duplicate-input", cwd, roots: [cwd, shared, shared], expected: [realCwd, realShared] },
    { name: "linked-roots", cwd: linkedCwd, roots: [linkedShared, shared], expected: [realCwd, realShared] },
  ]) {
    let threadId: string | null = null;
    for (const operation of ["thread/start", "thread/resume"]) {
      const log = join(root, `${scenario.name}-${operation.replace("/", "-")}.jsonl`);
      // No inherited environment, credentials, account reads, model list, or spawn override.
      const client = new MuseAgentClient(
        { executable, version: "fixture" },
        {
          apiKey: () => null,
          requestTimeoutMs: deadlineMs,
          env: { HOME: home, TMPDIR: root, FIXTURE_LOG: log, FIXTURE_FINGERPRINT: EXPECTED_SCHEMA_FINGERPRINT },
        },
      );
      const result: CaseResult = {
        name: scenario.name,
        operation,
        inputRoots: scenario.roots,
        expectedRoots: scenario.expected,
        notifications: [],
        requests: [],
        failures: [],
        cleanup: { clientStopped: false, children: [] },
      };
      report.cases.push(result);
      client.start();
      try {
        assert.ok(operation !== "thread/resume" || threadId, "A saved thread is required for resume.");
        threadId = await bounded(
          runCauseEffect(
            client.request(
              operation,
              { cwd: scenario.cwd, runtimeWorkspaceRoots: scenario.roots, ...(threadId ? { threadId } : {}) },
              decodeThreadId,
            ),
          ),
          operation,
        );
        await turn(client, threadId, result);
      } catch (error) {
        result.failures.push(message(error));
      } finally {
        try {
          // SDK shutdown is bounded at 10 seconds plus its 2 second signal grace.
          await bounded(runCauseEffect(client.stop()), "client stop", 15_000);
          result.cleanup.clientStopped = !client.running;
        } catch (error) {
          result.failures.push(message(error));
        }
        try {
          result.requests = await entries(log);
          for (const entry of result.requests.filter((entry) => entry.event === "spawn")) {
            const stopped = !running(entry.pid);
            result.cleanup.children.push({
              pid: entry.pid,
              stopped,
              eof: result.requests.some((row) => row.pid === entry.pid && row.event === "eof"),
            });
            if (!stopped) {
              // Only a PID recorded by this run's private fixture can be stopped here.
              process.kill(entry.pid, "SIGKILL");
              result.failures.push("SDK stop left the owned fixture running; sent SIGKILL.");
            }
          }
          const turns = result.requests.filter((entry) => entry.event === "request" && entry.method === "turn/start");
          result.observedRoots = turns[0]?.params?.workspaceRoots;
          assert.equal(turns.length, 1, "Exactly one turn reaches the fixture.");
          assert.equal(result.cleanup.children.length, 1, "Exactly one fixture process starts.");
          assert.ok(
            result.cleanup.children.every((child) => child.stopped && child.eof),
            "The SDK stops its child through EOF.",
          );
          assert.deepEqual(
            result.requests.filter((entry) => entry.event === "request").map((entry) => entry.method),
            [
              "initialize",
              "initialized",
              operation === "thread/start" ? "session/start" : "session/resume",
              "turn/start",
              ...(result.requests.some((entry) => entry.event === "accepted") ? ["session/read"] : []),
            ],
          );
          assert.equal(
            result.requests.some((entry) => entry.event === "deadline"),
            false,
          );
          assert.equal(
            result.requests.filter((entry) => entry.event === "rejected").length,
            result.clientError ? 1 : 0,
          );
          // Keep the same success contract in before and after. A rejection is never a pass.
          assert.ok(!result.clientError, `Turn must be accepted. Client error: ${result.clientError}`);
          assert.deepEqual(result.observedRoots, scenario.expected, "Preserve cwd and each extra root once.");
          assert.equal(result.requests.filter((entry) => entry.event === "accepted").length, 1);
          assert.equal(result.notifications.filter((event) => event.method === "turn/completed").length, 1);
          const completed = result.notifications.find((event) => event.method === "turn/completed");
          assert.equal(isRecord(completed?.params) ? getString(completed.params.turn, "status") : null, "completed");
          assert.ok(
            result.notifications.some(
              (event) =>
                event.method === "item/completed" &&
                isRecord(event.params) &&
                getString(event.params.item, "text") === "OK",
            ),
          );
        } catch (error) {
          result.failures.push(message(error));
        }
      }
    }
  }
} catch (error) {
  report.failures.push(message(error));
} finally {
  if (root) {
    try {
      await rm(root, { recursive: true, force: true });
      report.tempRemoved = true;
    } catch (error) {
      report.failures.push(message(error));
    }
  }
  report.failureCount =
    report.failures.length + report.cases.reduce((count, result) => count + result.failures.length, 0);
  report.passed = report.failureCount === 0 && report.cases.length === 6 && report.tempRemoved;
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ passed: report.passed, failureCount: report.failureCount, report: join(out, "report.json") })}\n`,
  );
  process.exitCode = report.passed ? 0 : 1;
}

async function turn(client: MuseAgentClient, threadId: string, result: CaseResult): Promise<void> {
  let finish: (() => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  const completed = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  // Attach a rejection handler before the request can fail or emit an exit event.
  void completed.catch(() => undefined);
  const notification = (event: AppServerNotification) => {
    if (getString(event.params, "threadId") !== threadId) return;
    result.notifications.push(event);
    if (event.method === "turn/completed") finish?.();
  };
  const exit = (error: Error) => fail?.(error);
  client.on("notification", notification);
  client.on("exit", exit);
  try {
    try {
      result.clientResult = await bounded(
        runCauseEffect(
          client.request("turn/start", { threadId, input: [{ type: "text", text: "Reply OK." }] }, (v) => v),
        ),
        "turn/start",
      );
    } catch (error) {
      result.clientError = message(error);
    }
    await bounded(completed, "turn/completed");
  } finally {
    client.off("notification", notification);
    client.off("exit", exit);
  }
}
