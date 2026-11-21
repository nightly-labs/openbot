import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { refusedSessionFailure } from "../src/backend/agent/thread-items";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MuseAgentClient } from "../src/backend/muse-client";
import { type AppServerNotification, getString, isRecord } from "../src/backend/protocol";

const museArg = process.argv.slice(2).find((arg) => arg.startsWith("--muse="));
const executable = museArg ? museArg.slice(7) : join(process.env.HOME ?? "", ".local/bin/muse");
const out = resolve(import.meta.dirname, "../.openbot-build/muse-mcp-startup-fault-e2e");
const turnDeadlineMs = 180_000;

interface Step {
  name: string;
  sessionId: string | null;
  status: string | null;
  error: string | null;
  requestError: string | null;
  refusedFailure: string | null;
  failures: string[];
}

const report: { executable: string; passed: boolean; steps: Step[]; failures: string[] } = {
  executable,
  passed: false,
  steps: [],
  failures: [],
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function bounded<T>(promise: Promise<T>, label: string, ms: number): Promise<T> {
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

function brokenServer(): McpServerConfig {
  return {
    id: "broken-framing",
    name: "broken_framing",
    transport: "stdio",
    enabled: true,
    command: "/bin/sh",
    args: ["-c", "printf 'not json-rpc\\r\\n\\r\\n'; sleep 120"],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: "",
    headers: [],
  };
}

async function run(name: string, cwd: string, servers: McpServerConfig[], resumeId: string | null): Promise<Step> {
  const step: Step = {
    name,
    sessionId: null,
    status: null,
    error: null,
    requestError: null,
    refusedFailure: null,
    failures: [],
  };
  report.steps.push(step);
  const client = new MuseAgentClient(
    { executable, version: "local" },
    {
      apiKey: () => process.env.META_API_KEY ?? null,
      requestTimeoutMs: 60_000,
      env: process.env,
      mcpServers: () => servers,
    },
  );
  client.start();
  try {
    const thread = await bounded(
      runCauseEffect(
        client.request(
          resumeId ? "thread/resume" : "thread/start",
          { cwd, ...(resumeId ? { threadId: resumeId } : {}) },
          (value) => {
            assert.ok(isRecord(value));
            const id = getString(value.thread, "id");
            assert.ok(id, "The client returns a thread ID.");
            return id;
          },
        ),
      ),
      `${name} open`,
      60_000,
    );
    step.sessionId = thread;
    let finish: ((status: string) => void) | undefined;
    const completed = new Promise<string>((done) => {
      finish = done;
    });
    const listener = (event: AppServerNotification) => {
      if (getString(event.params, "threadId") !== thread) return;
      if (event.method === "error" && isRecord(event.params)) {
        step.error = getString(event.params.error, "message");
      }
      if (event.method === "turn/completed" && isRecord(event.params)) {
        finish?.(getString(event.params.turn, "status") ?? "unknown");
      }
    };
    client.on("notification", listener);
    try {
      await runCauseEffect(
        client.request(
          "turn/start",
          { threadId: thread, input: [{ type: "text", text: "Reply with the single word OK." }] },
          (value) => value,
        ),
      ).catch((error: unknown) => {
        step.requestError = message(error);
      });
      step.status = await bounded(completed, `${name} turn`, turnDeadlineMs);
    } finally {
      client.off("notification", listener);
    }
    step.refusedFailure = step.error === null ? null : refusedSessionFailure("muse", step.error);
  } catch (error) {
    step.failures.push(message(error));
  } finally {
    await bounded(runCauseEffect(client.stop()), `${name} stop`, 15_000).catch((error: unknown) =>
      step.failures.push(message(error)),
    );
  }
  return step;
}

let root: string | undefined;
try {
  root = await realpath(await mkdtemp(join(tmpdir(), "openbot-muse-mcp-fault-")));
  const cwd = join(root, "workspace");
  await mkdir(cwd);
  const faulted = await run("broken-mcp-start", cwd, [brokenServer()], null);
  assert.equal(faulted.status, "failed", "A session with a broken MCP server fails its turn.");
  assert.ok(faulted.refusedFailure, `OpenBot closes the session for this error: ${faulted.error}`);
  assert.ok(faulted.sessionId);
  const resumed = await run("resume-without-mcp", cwd, [], faulted.sessionId);
  assert.equal(resumed.status, "failed", "Muse keeps the fault in the session after a resume.");
  assert.ok(resumed.refusedFailure, `OpenBot closes the session for this error: ${resumed.error}`);
  const fresh = await run("new-session-without-mcp", cwd, [], null);
  assert.equal(fresh.status, "completed", "A new session answers.");
} catch (error) {
  report.failures.push(message(error));
} finally {
  if (root) await rm(root, { recursive: true, force: true });
  const failures = report.failures.length + report.steps.reduce((count, step) => count + step.failures.length, 0);
  report.passed = failures === 0 && report.steps.length === 3;
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ passed: report.passed, report: join(out, "report.json") })}\n`);
  process.exitCode = report.passed ? 0 : 1;
}
