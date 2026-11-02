// Reads the Gemini plan usage end to end on the real Antigravity driver and ACP client, with a fake
// server that answers `/usage` the way Antigravity 1.4.1 does: one Markdown answer in its own
// session, and no model turn. Checks that a Google sign-in gives the Gemini weekly window and not
// the Claude and GPT one, that a model with a quota group of its own gets that group's window
// (#3055), that the reading names every group for the usage popover and the composer notice, that an
// API key sign-in and a 1.3.0 server give no reading, that 1.3.0 is never sent
// `/usage`, that the answer reaches no thread, and that later reads reuse the first session: each
// new Antigravity session leaves a conversation database on disk.
// `bun scripts/antigravity-usage-e2e.ts`. Writes .openbot-build/antigravity-usage-e2e/report.json.
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type AccountUsage, isAccountUsage, usageGroupForModel, usageQuotaForModel } from "@openbot/contracts/ipc";
import { normalizeAccountUsage } from "../src/backend/agent/account-usage";
import type { AgentClient } from "../src/backend/agent-client";
import type { AgentCliInfo } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type AccountRateLimitsReadResult, decodeAccountRateLimitsReadResult } from "../src/backend/protocol";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";

const OUT = resolve(import.meta.dirname, "../.openbot-build/antigravity-usage-e2e");

/** The answer of Antigravity 1.4.1's `format_usage_message` for a Google sign-in. */
const GOOGLE_ANSWER = [
  "### Session Usage",
  "- No token usage recorded yet.",
  "### Quota Limits",
  "- **Gemini Models**",
  "  *(Models within this group: Gemini Flash, Gemini Pro)*",
  "  - **Weekly Limit Remaining:** 96% remaining (resets Oct 29, 2026, 10:12 UTC)",
  "- **Claude and GPT models**",
  "  *(Models within this group: Claude Opus, Claude Sonnet, GPT-OSS)*",
  "  - **Weekly Limit Remaining:** 12% remaining (resets Oct 30, 2026, 08:00 UTC)",
].join("\n");
/** The same answer for a plan that gives Gemini 4 Argon a group of its own, here spent (#3055). */
const ARGON_ANSWER = [
  "### Session Usage",
  "- No token usage recorded yet.",
  "### Quota Limits",
  "- **Gemini Models**",
  "  *(Models within this group: Gemini Flash, Gemini Pro)*",
  "  - **Weekly Limit Remaining:** 100% remaining (resets Oct 31, 2026, 08:19 UTC)",
  "- **Gemini 4 Argon**",
  "  *(Models within this group: Gemini 4 Argon)*",
  "  - **Weekly Limit Remaining:** 0% remaining (resets Oct 30, 2026, 10:00 UTC)",
  "- **Claude and GPT models**",
  "  *(Models within this group: Claude Opus, Claude Sonnet, GPT-OSS)*",
  "  - **Weekly Limit Remaining:** 100% remaining (resets Nov 01, 2026, 11:15 UTC)",
].join("\n");
const API_KEY_ANSWER = [
  "### Session Usage",
  "- No token usage recorded yet.",
  "### Quota Limits",
  "- Not applicable for current authentication method.",
].join("\n");

// Logs every request method, and answers a prompt that starts with `/usage` with `FAKE_AGY_ANSWER`
// in one `agent_message_chunk` before the prompt returns. Any other prompt is a model turn.
const FAKE_AGY = `#!/usr/bin/env node
const fs = require("node:fs");
const NL = String.fromCharCode(10);
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
function handle(message) {
  if (message.method) fs.appendFileSync(process.env.FAKE_AGY_LOG, JSON.stringify({
    method: message.method, sessionId: message.params && message.params.sessionId,
    text: message.params && message.params.prompt && message.params.prompt.map((block) => block.text).join(""),
  }) + NL);
  if (message.id === undefined) return;
  if (message.method === "initialize") {
    write({ id: message.id, result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] } });
    return;
  }
  if (message.method === "session/new") {
    write({ id: message.id, result: {
      sessionId: "s-" + message.id,
      models: { availableModels: [{ modelId: "gemini-fake", name: "Gemini Fake" }], currentModelId: "gemini-fake" },
    } });
    return;
  }
  if (message.method === "session/prompt") {
    const text = message.params.prompt.map((block) => block.text).join("");
    if (text.startsWith("/usage")) write({ method: "session/update", params: {
      sessionId: message.params.sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: process.env.FAKE_AGY_ANSWER } },
    } });
    write({ id: message.id, result: { stopReason: "end_turn" } });
    return;
  }
  write({ id: message.id, result: {} });
}
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf(NL)) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});
setInterval(() => {}, 1000);
`;

interface LogEntry {
  method: string;
  sessionId?: string;
  text?: string;
}

interface UsageCase {
  version: string;
  model: string | undefined;
  readings: AccountRateLimitsReadResult[];
  prompts: string[];
  usageSessions: string[];
  notifications: string[];
}

interface Report {
  passed: boolean;
  googleSignIn?: UsageCase;
  perModel?: UsageCase[];
  groups?: AccountUsage;
  apiKeySignIn?: UsageCase;
  olderRuntime?: UsageCase;
}

const root = await mkdtemp(join(tmpdir(), "openbot-antigravity-usage-e2e-"));
const log = join(root, "agy.jsonl");
const report: Report = { passed: false };
const clients: AgentClient[] = [];
process.env.FAKE_AGY_LOG = log;

async function readLog(): Promise<LogEntry[]> {
  const text = await readFile(log, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function install(version: string): Promise<AgentCliInfo> {
  const executable = join(root, "agy", version, "bin", "agy_acp_server");
  await mkdir(join(root, "agy", version, "bin"), { recursive: true });
  await writeFile(executable, FAKE_AGY);
  await chmod(executable, 0o755);
  return { executable, version, source: "managed" };
}

/** `reads` usage reads at once on one process, as a dock poll and a refresh after a limit can. */
async function readUsage(version: string, answer: string, reads: number, model?: string): Promise<UsageCase> {
  await rm(log, { force: true });
  process.env.FAKE_AGY_ANSWER = answer;
  const client = requireProviderDriver("antigravity").createClient(
    await install(version),
    10_000,
    NO_PROVIDER_CREDENTIALS,
  );
  clients.push(client);
  const notifications: string[] = [];
  client.on("notification", (notification) => notifications.push(notification.method));
  client.start();
  const readings = await Promise.all(
    Array.from({ length: reads }, () =>
      runCauseEffect(client.request("account/rateLimits/read", { model }, decodeAccountRateLimitsReadResult)),
    ),
  );
  const prompts = (await readLog()).filter((entry) => entry.method === "session/prompt");
  return {
    version,
    model,
    readings,
    prompts: prompts.map((entry) => entry.text ?? ""),
    usageSessions: [...new Set(prompts.flatMap((entry) => (entry.sessionId ? [entry.sessionId] : [])))],
    notifications,
  };
}

try {
  // 1. A Google sign-in on 1.4.1: the Gemini group's weekly window, both reads in one session.
  const google = await readUsage("1.4.1", GOOGLE_ANSWER, 2, "gemini-3.8-flash-high");
  report.googleSignIn = google;
  assert.deepEqual(google.prompts, ["/usage", "/usage"], "1.4.1 is sent `/usage` for each read");
  assert.equal(google.usageSessions.length, 1, "the second read reuses the first read's session");
  for (const reading of google.readings)
    assert.deepEqual(reading.rateLimits, {
      limitId: "antigravity",
      primary: null,
      secondary: { usedPercent: 4, windowDurationMins: 10_080, resetsAt: Date.UTC(2026, 9, 29, 10, 12) / 1_000 },
    });
  assert.ok(
    !google.notifications.some((method) => method.startsWith("item/") || method.startsWith("turn/")),
    `the answer reaches no thread: ${google.notifications.join(", ")}`,
  );

  // 2. Gemini 4 Argon has a group of its own. Its spent window is not Flash's, and Flash's room is
  // not Argon's. The dock's reading, with no model, is the "Gemini Models" group.
  const weekly = (usedPercent: number, resetsAt: number) => ({
    limitId: "antigravity",
    primary: null,
    secondary: { usedPercent, windowDurationMins: 10_080, resetsAt: resetsAt / 1_000 },
  });
  const flashRoom = weekly(0, Date.UTC(2026, 9, 31, 8, 19));
  const argonSpent = weekly(100, Date.UTC(2026, 9, 30, 10, 0));
  const perModel: UsageCase[] = [];
  report.perModel = perModel;
  for (const [model, expected] of [
    ["gemini-3.8-flash-high", flashRoom],
    ["gemini-3.1-pro", flashRoom],
    ["gemini-4-argon-high", argonSpent],
    ["gemini-4-argon", argonSpent],
    [undefined, flashRoom],
    ["gemini-codename-x", null],
  ] as const) {
    const reading = await readUsage("1.4.3", ARGON_ANSWER, 1, model);
    perModel.push(reading);
    assert.deepEqual(reading.readings[0]?.rateLimits ?? null, expected, `the reading of ${model ?? "the dock"}`);
  }

  // 3. The dock's reading names every group, so the popover shows one line each and the composer
  // finds the group of the agent's model. It passes the contract's decoder.
  const usage = normalizeAccountUsage(perModel.find((reading) => reading.model === undefined)?.readings[0] ?? null);
  report.groups = usage;
  assert.ok(isAccountUsage(usage), "the reading with groups passes the IPC decoder");
  const groups = usage.limits[0]?.groups ?? [];
  assert.deepEqual(
    groups.map((group) => [group.name, group.models, group.secondary?.usedPercent]),
    [
      ["Gemini Models", ["Gemini Flash", "Gemini Pro"], 0],
      ["Gemini 4 Argon", ["Gemini 4 Argon"], 100],
      ["Claude and GPT models", ["Claude Opus", "Claude Sonnet", "GPT-OSS"], 0],
    ],
  );
  for (const [model, name] of [
    ["gemini-3.8-flash-high", "Gemini Models"],
    ["gemini-4-argon-high", "Gemini 4 Argon"],
    ["claude-opus-4-6-thinking", "Claude and GPT models"],
    ["gemini-codename-x", undefined],
  ] as const)
    assert.equal(usageGroupForModel(groups, model)?.name, name, `the group of ${model}`);
  // A kept account reading has no model: the usage limit check takes the model's group from it, and
  // with no model it keeps the reading's own windows.
  const dock = usage.limits[0];
  assert.ok(dock, "the dock reading has a limit");
  assert.equal(usageQuotaForModel(dock, "gemini-4-argon-high")?.secondary?.usedPercent, 100, "Argon's own quota");
  assert.equal(usageQuotaForModel(dock, ""), dock, "no model keeps the reading");
  assert.equal(usageQuotaForModel(dock, "gemini-codename-x"), undefined, "an unlisted model has no quota");

  // 4. An API key sign-in has no plan quota.
  const apiKey = await readUsage("1.4.1", API_KEY_ANSWER, 1);
  report.apiKeySignIn = apiKey;
  assert.deepEqual(apiKey.prompts, ["/usage"]);
  assert.equal(apiKey.readings[0]?.rateLimits ?? null, null, "an API key sign-in gives no reading");

  // 5. 1.3.0 sends `/usage` to the model, so it is never sent.
  const older = await readUsage("1.3.0", GOOGLE_ANSWER, 1);
  report.olderRuntime = older;
  assert.deepEqual(older.prompts, [], "1.3.0 is not sent `/usage`");
  assert.equal(older.readings[0]?.rateLimits ?? null, null, "1.3.0 gives no reading");

  report.passed = true;
} finally {
  for (const client of clients) await runCauseEffect(client.stop()).catch(() => undefined);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
