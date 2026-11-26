import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { agentProviderName } from "@openbot/contracts/agent-providers";
import { sourceText } from "@openbot/i18n/source";
import { userErrorMessage } from "@openbot/user-errors";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { PiAgentClient } from "../src/backend/pi-client";
import { getString, isRecord } from "../src/backend/protocol";

const out = resolve(import.meta.dirname, "../.openbot-build/pi-setup-timeout-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-pi-setup-timeout-"));
const log = join(root, "pi.jsonl");

const fakePi = String.raw`
const fs = require("node:fs");
const readline = require("node:readline");
const [logPath, sessionFile] = process.argv.slice(2);
const log = (entry) => fs.appendFileSync(logPath, JSON.stringify(entry) + "\n");
const reply = (message, data) =>
  process.stdout.write(JSON.stringify({ type: "response", id: message.id, command: message.type, success: true, data }) + "\n");
let modelSets = 0;
const lines = readline.createInterface({ input: process.stdin });
lines.on("close", () => process.exit(0));
lines.on("line", (line) => {
  const message = JSON.parse(line);
  log({ event: "request", type: message.type });
  if (message.id === undefined) return;
  if (message.type === "get_state") return reply(message, { sessionFile });
  if (message.type === "switch_session") return reply(message, {});
  if (message.type === "get_session_stats") return reply(message, { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
  if (message.type === "set_model") {
    modelSets += 1;
    if (modelSets > 1) return log({ event: "silent", type: message.type });
    return reply(message, {});
  }
  if (message.type === "prompt") {
    log({ event: "prompt" });
    return reply(message, { disposition: "handled" });
  }
  reply(message, {});
});
`;

interface Report {
  passed: boolean;
  expected: string;
  error: string | null;
  bannerText: string | null;
  namesRequest: boolean;
  prompts: number;
  silentRequests: string[];
  errors: string[];
}

const expected = sourceText("error.provider.acpSettingsTimedOut", { provider: agentProviderName("pi") });
const report: Report = {
  passed: false,
  expected,
  error: null,
  bannerText: null,
  namesRequest: false,
  prompts: 0,
  silentRequests: [],
  errors: [],
};

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

async function entries(): Promise<unknown[]> {
  const text = await readFile(log, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line): unknown => JSON.parse(line));
}

try {
  await writeFile(join(root, "fake-pi.cjs"), fakePi);
  const executable = join(root, "pi");
  const args = [process.execPath, join(root, "fake-pi.cjs"), log, join(root, "session.jsonl")];
  await writeFile(executable, `#!/bin/sh\nexec ${args.map(shellQuote).join(" ")}\n`);
  await chmod(executable, 0o700);
  const client = new PiAgentClient(
    { executable, version: "fixture" },
    { requestTimeoutMs: 15_000, providerStateDirectory: root },
  );
  client.start();
  try {
    const model = "fixture/model";
    const opened = await runCauseEffect(client.request("thread/start", { cwd: root, model }, (value) => value));
    const threadId = isRecord(opened) ? getString(opened.thread, "id") : null;
    assert.ok(threadId, "thread/start must return an id.");
    try {
      await runCauseEffect(
        client.request("turn/start", { threadId, model, input: [{ type: "text", text: "Hello" }] }, (value) => value),
      );
    } catch (cause) {
      report.error = cause instanceof Error ? cause.message : String(cause);
    }
  } finally {
    await runCauseEffect(client.stop());
  }
  const logged = await entries();
  report.prompts = logged.filter((entry) => getString(entry, "event") === "prompt").length;
  report.silentRequests = logged
    .filter((entry) => getString(entry, "event") === "silent")
    .map((entry) => getString(entry, "type") ?? "");
  if (report.error !== null) {
    report.bannerText = userErrorMessage(report.error, "fallback");
    report.namesRequest = report.error.includes("set_model");
  }
  report.passed =
    report.error === expected &&
    report.bannerText === expected &&
    !report.namesRequest &&
    report.prompts === 0 &&
    report.silentRequests.includes("set_model");
} catch (error) {
  report.errors.push(error instanceof Error ? error.message : String(error));
} finally {
  await rm(root, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ passed: report.passed, report: join(out, "report.json") })}\n`);
  process.exitCode = report.passed ? 0 : 1;
}
