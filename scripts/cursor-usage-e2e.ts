// Reads the Cursor plan usage end to end on the real Cursor driver and ACP client, with a fake
// `cursor-agent acp` and a local server in place of the Cursor backend (`CURSOR_API_ENDPOINT`). The
// sign-in is a fake `auth.json` in a temporary home. Checks that a split plan gives the Cursor
// models window and the other models window for the billing cycle, that a plan with only a total
// gives one window, that a merged plan gives the total alone and names Grok as sharing its quota, that
// a plan info that fails to read keeps the split, and that a rejected token and a missing sign-in give
// no reading.
// `bun scripts/cursor-usage-e2e.ts`. Writes .openbot-build/cursor-usage-e2e/report.json.
//
// On macOS the reader asks the login Keychain first. With the Cursor CLI signed in there, the
// local server sees a token that is not the fake one and the run fails: sign the CLI out first.
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { normalizeAccountUsage } from "../src/backend/agent/account-usage";
import type { AgentClient } from "../src/backend/agent-client";
import { cursorAuthFile } from "../src/backend/cursor-usage";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type AccountRateLimitsReadResult, decodeAccountRateLimitsReadResult } from "../src/backend/protocol";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";

const OUT = resolve(import.meta.dirname, "../.openbot-build/cursor-usage-e2e");
const FAKE_TOKEN = "fake-cursor-access-token";
const USAGE_PATH = "/aiserver.v1.DashboardService/GetCurrentPeriodUsage";
const PLAN_INFO_PATH = "/aiserver.v1.DashboardService/GetPlanInfo";
const CYCLE_START = Date.UTC(2026, 9, 1);
const CYCLE_END = Date.UTC(2026, 9, 31);

// Answers `initialize` and `session/new` with one model, so the client counts as signed in.
const FAKE_CURSOR = `#!/usr/bin/env node
const NL = String.fromCharCode(10);
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
function handle(message) {
  if (message.id === undefined) return;
  if (message.method === "initialize") {
    write({ id: message.id, result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] } });
    return;
  }
  if (message.method === "session/new") {
    write({ id: message.id, result: {
      sessionId: "s-" + message.id,
      models: { availableModels: [{ modelId: "composer-fake", name: "Composer Fake" }], currentModelId: "composer-fake" },
    } });
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

interface UsageRequest {
  method: string;
  path: string;
  /** Whether the bearer token was the fake sign-in's. The token itself is not kept. */
  fakeToken: boolean;
  body: string;
}

interface UsageCase {
  reading: AccountRateLimitsReadResult;
  requests: UsageRequest[];
}

interface Report {
  passed: boolean;
  splitPlan?: UsageCase;
  totalOnlyPlan?: UsageCase;
  mergedPlan?: UsageCase;
  planInfoFailed?: UsageCase;
  rejectedToken?: UsageCase;
  noSignIn?: UsageCase;
}

const root = await mkdtemp(join(tmpdir(), "openbot-cursor-usage-e2e-"));
const report: Report = { passed: false };
const clients: AgentClient[] = [];
interface Answer {
  status: number;
  body: unknown;
}
const NOT_MERGED: Answer = { status: 200, body: { planInfo: { planName: "Pro" }, isMerged: false } };
let answers: Record<string, Answer> = {};
let requests: UsageRequest[] = [];

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => resolveBody(body));
    request.on("error", reject);
  });
}

const server = createServer((request, response) => {
  void readBody(request).then((body) => {
    requests.push({
      method: request.method ?? "",
      path: request.url ?? "",
      fakeToken: request.headers.authorization === `Bearer ${FAKE_TOKEN}`,
      body,
    });
    const answer = answers[request.url ?? ""] ?? { status: 404, body: { code: "not_found" } };
    response.writeHead(answer.status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(answer.body));
  });
});
await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));

process.env.HOME = join(root, "home");
process.env.XDG_CONFIG_HOME = join(root, "home", ".config");
process.env.APPDATA = join(root, "home", "AppData", "Roaming");
const address = server.address();
if (!address || typeof address === "string") throw new Error("The usage server has no port.");
process.env.CURSOR_API_ENDPOINT = `http://127.0.0.1:${address.port}`;
const authFile = cursorAuthFile();

async function install(): Promise<string> {
  const executable = join(root, "cursor", "cursor-agent");
  await mkdir(dirname(executable), { recursive: true });
  await writeFile(executable, FAKE_CURSOR);
  await chmod(executable, 0o755);
  return executable;
}

const executable = await install();

async function readUsage(status: number, body: unknown, planInfo: Answer = NOT_MERGED): Promise<UsageCase> {
  answers = { [USAGE_PATH]: { status, body }, [PLAN_INFO_PATH]: planInfo };
  requests = [];
  const client = requireProviderDriver("cursor").createClient(
    { executable, version: "2026.10.01-e373342", source: "managed" },
    10_000,
    NO_PROVIDER_CREDENTIALS,
  );
  clients.push(client);
  client.start();
  const reading = await runCauseEffect(
    client.request("account/rateLimits/read", { model: "composer-fake" }, decodeAccountRateLimitsReadResult),
  );
  return { reading, requests };
}

const cycle = { windowDurationMins: 43_200, resetsAt: CYCLE_END / 1_000 };

try {
  await mkdir(dirname(authFile), { recursive: true });
  await writeFile(authFile, JSON.stringify({ accessToken: FAKE_TOKEN, refreshToken: "fake-refresh" }));

  // 1. A plan split into Cursor's own models and the others. Connect JSON writes int64 as strings.
  const split = await readUsage(200, {
    billingCycleStart: String(CYCLE_START),
    billingCycleEnd: String(CYCLE_END),
    planUsage: { autoPercentUsed: 37.5, apiPercentUsed: 82, totalPercentUsed: 60 },
  });
  report.splitPlan = split;
  assert.ok(
    split.requests.every((request) => request.fakeToken),
    "the requests carry the CLI's sign-in (sign the macOS CLI out first)",
  );
  assert.deepEqual(
    split.requests.map(({ fakeToken: _, ...request }) => request).sort((a, b) => a.path.localeCompare(b.path)),
    [
      { method: "POST", path: USAGE_PATH, body: "{}" },
      { method: "POST", path: PLAN_INFO_PATH, body: "{}" },
    ],
    "one usage request and one plan info request",
  );
  assert.deepEqual(split.reading.rateLimits, {
    limitId: "cursor",
    primary: { usedPercent: 37.5, ...cycle },
    secondary: { usedPercent: 82, ...cycle },
  });
  assert.equal(split.reading.sharedQuotaWith, undefined, "a split plan shares no quota");

  // 2. A plan with only a total fills the first window with it.
  const total = await readUsage(200, {
    billingCycleStart: CYCLE_START,
    billingCycleEnd: CYCLE_END,
    planUsage: { totalPercentUsed: 120 },
  });
  report.totalOnlyPlan = total;
  assert.deepEqual(total.reading.rateLimits, {
    limitId: "cursor",
    primary: { usedPercent: 100, ...cycle },
    secondary: null,
  });
  assert.equal(total.reading.sharedQuotaWith, undefined, "a plan that is not merged shares no quota");

  // 3. A merged plan includes no other models: the total alone, with no other models window. That
  // total is the Grok plan quota, so the reading and the dock limit name Grok as sharing it.
  const merged = await readUsage(
    200,
    {
      billingCycleStart: String(CYCLE_START),
      billingCycleEnd: String(CYCLE_END),
      planUsage: { autoPercentUsed: 37.5, apiPercentUsed: 0, totalPercentUsed: 45 },
    },
    { status: 200, body: { planInfo: { planName: "Pro" }, isMerged: true } },
  );
  report.mergedPlan = merged;
  assert.deepEqual(merged.reading.rateLimits, {
    limitId: "cursor",
    primary: { usedPercent: 45, ...cycle },
    secondary: null,
  });
  assert.equal(merged.reading.sharedQuotaWith, "grok", "a merged plan shares the Grok quota");
  assert.equal(normalizeAccountUsage(merged.reading).limits[0]?.sharedQuotaWith, "grok", "the dock limit keeps it");

  // 4. A plan info that fails to read keeps the split reading.
  const planInfoFailed = await readUsage(
    200,
    {
      billingCycleStart: String(CYCLE_START),
      billingCycleEnd: String(CYCLE_END),
      planUsage: { autoPercentUsed: 37.5, apiPercentUsed: 82, totalPercentUsed: 60 },
    },
    { status: 500, body: { code: "internal" } },
  );
  report.planInfoFailed = planInfoFailed;
  assert.deepEqual(planInfoFailed.reading.rateLimits, {
    limitId: "cursor",
    primary: { usedPercent: 37.5, ...cycle },
    secondary: { usedPercent: 82, ...cycle },
  });
  assert.equal(planInfoFailed.reading.sharedQuotaWith, undefined, "an unread plan info shares no quota");

  // 5. A token the backend rejects gives no reading.
  const rejected = await readUsage(
    401,
    { code: "unauthenticated" },
    { status: 401, body: { code: "unauthenticated" } },
  );
  report.rejectedToken = rejected;
  assert.equal(rejected.requests.length, 2);
  assert.equal(rejected.reading.rateLimits ?? null, null, "a rejected token gives no reading");

  // 6. With no sign-in file there is nothing to send.
  await rm(authFile, { force: true });
  const noSignIn = await readUsage(200, { planUsage: { autoPercentUsed: 1 } });
  report.noSignIn = noSignIn;
  assert.equal(noSignIn.reading.rateLimits ?? null, null, "no sign-in gives no reading");
  assert.equal(noSignIn.requests.length, 0, "no request without a sign-in");

  report.passed = true;
} finally {
  for (const client of clients) await runCauseEffect(client.stop()).catch(() => undefined);
  server.close();
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
