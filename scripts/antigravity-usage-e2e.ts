import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type AccountUsage, isAccountUsage, usageGroupForModel, usageQuotaForModel } from "@openbot/contracts/ipc";
import { normalizeAccountUsage } from "../src/backend/agent/account-usage";
import type { AgentClient } from "../src/backend/agent-client";
import { type AgentCliInfo, resolveAntigravityCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type AccountRateLimitsReadResult, decodeAccountRateLimitsReadResult } from "../src/backend/protocol";
import {
  NO_PROVIDER_CREDENTIALS,
  type ProviderClientContext,
  requireProviderDriver,
} from "../src/backend/provider-drivers";

const OUT = resolve(import.meta.dirname, "../.openbot-build/antigravity-usage-e2e");
const VERSION = "1.5.4";
const ACCESS_TOKEN = "fake-access-token";
const PROJECT = "fake-companion-project-123";

const GOOGLE_QUOTA = {
  groups: [
    {
      displayName: "Gemini Models",
      description: "Models within this group: Gemini Flash, Gemini Pro",
      buckets: [
        {
          bucketId: "gemini-weekly",
          displayName: "Weekly Limit Remaining",
          window: "weekly",
          resetTime: "2026-11-17T11:59:31Z",
          remainingFraction: 0.96,
        },
      ],
    },
    {
      displayName: "Claude and GPT models",
      description: "Models within this group: Claude Opus, Claude Sonnet, GPT-OSS",
      buckets: [
        {
          bucketId: "third-party-weekly",
          displayName: "Weekly Limit Remaining",
          window: "weekly",
          resetTime: "2026-11-18T08:00:00Z",
          remainingFraction: 0.12,
        },
      ],
    },
  ],
};
const ARGON_QUOTA = {
  groups: [
    {
      displayName: "Gemini Models",
      description: "Models within this group: Gemini Flash, Gemini Pro",
      buckets: [
        {
          displayName: "Weekly Limit Remaining",
          window: "weekly",
          resetTime: "2026-11-19T08:19:00Z",
          remainingFraction: 1,
        },
      ],
    },
    {
      displayName: "Gemini 4 Argon",
      description:
        "For paid Pro plans, Argon quota is separate. Higher Argon quota (included as part of the larger Gemini quota bucket) is available on Ultra plans.",
      buckets: [
        {
          bucketId: "gemini-argon-wtu-weekly",
          displayName: "Gemini 4 Argon Weekly Limit",
          window: "weekly",
          resetTime: "2026-11-18T10:00:00Z",
        },
        { bucketId: "gemini-argon-credits", window: "5h", resetTime: "2026-11-18T10:00:00Z", remainingAmount: "40" },
      ],
    },
    {
      displayName: "Claude and GPT models",
      description: "Models within this group: Claude Opus, Claude Sonnet, GPT-OSS",
      buckets: [
        {
          displayName: "Weekly Limit Remaining",
          window: "weekly",
          resetTime: "2026-11-20T11:15:00Z",
          remainingFraction: 1,
        },
      ],
    },
  ],
};

const NO_GEMINI_QUOTA = {
  groups: [
    {
      displayName: "Claude and GPT models",
      description: "Models within this group: Claude Opus, Claude Sonnet, GPT-OSS",
      buckets: [
        {
          displayName: "Weekly Limit Remaining",
          window: "weekly",
          resetTime: "2026-11-17T11:59:31Z",
          remainingFraction: 0.96,
        },
      ],
    },
  ],
};

const FAKE_ANTIGRAVITY = `#!/usr/bin/env node
if (process.argv[2] === "--version") {
  process.stdout.write("${VERSION}\\n");
  process.exit(0);
}
const fs = require("node:fs");
const NL = String.fromCharCode(10);
const log = (entry) => fs.appendFileSync(process.env.FAKE_AGY_LOG, JSON.stringify({ pid: process.pid, ...entry }) + NL);
log({ method: "start", argv: process.argv.slice(2) });
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
function handle(message) {
  if (message.method) log({ method: message.method, sessionId: message.params && message.params.sessionId });
  if (message.id === undefined) return;
  if (message.method === "initialize")
    return write({ id: message.id, result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] } });
  if (message.method === "session/new")
    return write({ id: message.id, result: {
      sessionId: "s-" + message.id,
      models: { availableModels: [{ modelId: "gemini-fake", name: "Gemini Fake" }], currentModelId: "gemini-fake" },
    } });
  if (message.method === "session/prompt") return write({ id: message.id, result: { stopReason: "end_turn" } });
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
  pid: number;
  method: string;
  argv?: string[];
}

interface QuotaRequest {
  method: string | undefined;
  path: string | undefined;
  authorization: string | undefined;
  userAgent: string | undefined;
  body: string;
}

interface QuotaService {
  status: number;
  project: string | null;
  quota: unknown;
}

interface UsageCase {
  name: string;
  model: string | undefined;
  readings: AccountRateLimitsReadResult[];
  quotaRequests: QuotaRequest[];
  acpMethods: string[];
}

interface Report {
  passed: boolean;
  cli?: AgentCliInfo;
  userAgent?: string;
  googleSignIn?: UsageCase & { acpMethodsDuringLaterReads: string[] };
  perModel?: UsageCase[];
  noGeminiGroup?: UsageCase[];
  untouchedReset?: UsageCase;
  groups?: AccountUsage;
  apiKeySignIn?: UsageCase;
  expiringToken?: UsageCase;
  importedToken?: UsageCase;
  forbidden?: UsageCase;
  missingProject?: UsageCase;
}

const root = await mkdtemp(join(tmpdir(), "openbot-antigravity-usage-e2e-"));
const log = join(root, "agy.jsonl");
const geminiHome = join(root, "gemini");
const tokenFile = join(geminiHome, "antigravity-acp", "antigravity-oauth-token");
const report: Report = { passed: false };
const clients: AgentClient[] = [];
let current: AgentClient | undefined;
const service: QuotaService = { status: 200, project: PROJECT, quota: GOOGLE_QUOTA };
const quotaRequests: QuotaRequest[] = [];
process.env.FAKE_AGY_LOG = log;
process.env.GEMINI_HOME = geminiHome;
delete process.env.OPENBOT_ANTIGRAVITY_PATH;

async function body(request: IncomingMessage): Promise<string> {
  let text = "";
  for await (const chunk of request) text += String(chunk);
  return text;
}

const server = createServer((request, response) => {
  void body(request).then((parsed) => {
    quotaRequests.push({
      method: request.method,
      path: request.url,
      authorization: request.headers.authorization,
      userAgent: request.headers["user-agent"],
      body: parsed,
    });
    response.setHeader("Content-Type", "application/json");
    if (service.status !== 200) {
      response.statusCode = service.status;
      response.end(JSON.stringify({ error: { code: service.status, message: "The caller does not have permission" } }));
      return;
    }
    if (request.url === "/v1internal:loadCodeAssist")
      return response.end(JSON.stringify(service.project ? { cloudaicompanionProject: service.project } : {}));
    if (request.url === "/v1internal:retrieveUserQuotaSummary") return response.end(JSON.stringify(service.quota));
    response.statusCode = 404;
    response.end("{}");
  });
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const quotaAddress = server.address();
assert.ok(quotaAddress !== null && typeof quotaAddress === "object");
process.env.OPENBOT_DEV_ANTIGRAVITY_CODE_ASSIST_URL = `http://127.0.0.1:${quotaAddress.port}/v1internal`;

async function readLog(): Promise<LogEntry[]> {
  const text = await readFile(log, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function writeToken(accessToken: string, expiry: string): Promise<void> {
  await mkdir(join(geminiHome, "antigravity-acp"), { recursive: true });
  await writeFile(
    tokenFile,
    JSON.stringify({
      token: { access_token: accessToken, token_type: "Bearer", refresh_token: "fake-refresh", expiry },
      auth_method: "consumer",
      id_token_email: "",
    }),
    { mode: 0o600 },
  );
}

const inOneHour = () => new Date(Date.now() + 3_600_000).toISOString();

async function install(): Promise<AgentCliInfo> {
  const executable = join(root, "antigravity", VERSION, "bin", "antigravity");
  await mkdir(join(root, "antigravity", VERSION, "bin"), { recursive: true });
  await writeFile(executable, FAKE_ANTIGRAVITY);
  await chmod(executable, 0o755);
  return await runCauseEffect(resolveAntigravityCli({ systemCandidates: [], bundledExecutable: executable }));
}

async function readUsage(
  cli: AgentCliInfo,
  name: string,
  reads: number,
  model?: string,
  context: ProviderClientContext = NO_PROVIDER_CREDENTIALS,
): Promise<UsageCase> {
  await rm(log, { force: true });
  quotaRequests.length = 0;
  const client = requireProviderDriver("antigravity").createClient(cli, 10_000, context);
  clients.push(client);
  current = client;
  client.start();
  const readings = await Promise.all(
    Array.from({ length: reads }, () =>
      runCauseEffect(client.request("account/rateLimits/read", { model }, decodeAccountRateLimitsReadResult)),
    ),
  );
  return {
    name,
    model,
    readings,
    quotaRequests: [...quotaRequests],
    acpMethods: (await readLog()).map((entry) => entry.method),
  };
}

const weekly = (usedPercent: number, resetTime: string) => ({
  limitId: "antigravity",
  primary: null,
  secondary: { usedPercent, windowDurationMins: 10_080, resetsAt: Date.parse(resetTime) / 1_000 },
});

function assertNoUsage(reading: UsageCase, calls: string[]): void {
  for (const value of reading.readings) assert.equal(value.rateLimits, null, `${reading.name}: no reading`);
  assert.deepEqual(
    reading.quotaRequests.map((request) => request.path),
    calls,
    `${reading.name}: the Code Assist calls`,
  );
  assert.ok(!reading.acpMethods.includes("session/prompt"), `${reading.name}: no prompt reaches the ACP server`);
}

try {
  const cli = await install();
  report.cli = cli;
  assert.equal(cli.version, VERSION);
  assert.equal(cli.source, "managed");
  const os = process.platform === "win32" ? "windows" : process.platform;
  const arch = process.arch === "x64" ? "amd64" : process.arch;
  report.userAgent = `antigravity/hub/2.24.0 (aidev_client; os_type=${os}; arch=${arch}; cl=963137146)`;

  await writeToken(ACCESS_TOKEN, inOneHour());
  const google = await readUsage(cli, "Google sign-in", 1, "gemini-3.8-flash-high");
  const expectedGoogle = weekly(4, "2026-11-17T11:59:31Z");
  assert.deepEqual(google.readings[0]?.rateLimits, expectedGoogle);
  assert.deepEqual(
    google.quotaRequests,
    [
      {
        method: "POST",
        path: "/v1internal:loadCodeAssist",
        authorization: `Bearer ${ACCESS_TOKEN}`,
        userAgent: report.userAgent,
        body: "{}",
      },
      {
        method: "POST",
        path: "/v1internal:retrieveUserQuotaSummary",
        authorization: `Bearer ${ACCESS_TOKEN}`,
        userAgent: report.userAgent,
        body: JSON.stringify({ project: PROJECT }),
      },
    ],
    "the token, Antigravity's User-Agent and the account's project",
  );
  const before = (await readLog()).length;
  const client = current;
  assert.ok(client, "the Google sign-in has a client");
  const later = await Promise.all(
    [0, 1].map(() =>
      runCauseEffect(
        client.request(
          "account/rateLimits/read",
          { model: "gemini-3.8-flash-high" },
          decodeAccountRateLimitsReadResult,
        ),
      ),
    ),
  );
  const logAfter = await readLog();
  report.googleSignIn = {
    ...google,
    readings: [...google.readings, ...later],
    quotaRequests: [...quotaRequests],
    acpMethodsDuringLaterReads: logAfter.slice(before).map((entry) => entry.method),
  };
  for (const reading of later) assert.deepEqual(reading.rateLimits, expectedGoogle);
  assert.equal(quotaRequests.length, 6, "each read calls Code Assist twice");
  assert.deepEqual(report.googleSignIn.acpMethodsDuringLaterReads, [], "a usage read sends nothing over ACP");
  assert.equal(logAfter.filter((entry) => entry.method === "start").length, 1, "a usage read starts no process");
  assert.ok(!logAfter.some((entry) => entry.method === "session/prompt"), "a usage read sends no prompt");

  service.quota = ARGON_QUOTA;
  const flashRoom = weekly(0, "2026-11-19T08:19:00Z");
  const argonSpent = weekly(100, "2026-11-18T10:00:00Z");
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
    const reading = await readUsage(cli, `model ${model ?? "of the dock"}`, 1, model);
    perModel.push(reading);
    assert.deepEqual(reading.readings[0]?.rateLimits ?? null, expected, `the reading of ${model ?? "the dock"}`);
  }

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
  const dock = usage.limits[0];
  assert.ok(dock, "the dock reading has a limit");
  assert.equal(usageQuotaForModel(dock, "gemini-4-argon-high")?.secondary?.usedPercent, 100, "Argon's own quota");
  assert.equal(usageQuotaForModel(dock, ""), dock, "no model keeps the reading");
  assert.equal(usageQuotaForModel(dock, "gemini-codename-x"), undefined, "an unlisted model has no quota");

  service.quota = NO_GEMINI_QUOTA;
  const claudeRoom = weekly(4, "2026-11-17T11:59:31Z");
  const noGeminiGroup: UsageCase[] = [];
  report.noGeminiGroup = noGeminiGroup;
  for (const [model, expected] of [
    [undefined, claudeRoom],
    ["claude-opus-4-6-thinking", claudeRoom],
    ["gemini-3.8-flash-high", null],
  ] as const) {
    const reading = await readUsage(cli, `no Gemini group, model ${model ?? "of the dock"}`, 1, model);
    noGeminiGroup.push(reading);
    assert.deepEqual(reading.readings[0]?.rateLimits ?? null, expected, `no Gemini group: ${model ?? "the dock"}`);
  }
  const noGeminiUsage = normalizeAccountUsage(noGeminiGroup[0]?.readings[0] ?? null);
  assert.ok(isAccountUsage(noGeminiUsage), "the reading with one group passes the IPC decoder");
  assert.deepEqual(
    noGeminiUsage.limits[0]?.groups?.map((group) => group.name),
    ["Claude and GPT models"],
    "the popover names the one group",
  );

  const rollingReset = new Date(Date.now() + 5 * 60 * 60_000).toISOString();
  const weekReset = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
  service.quota = {
    groups: [
      {
        displayName: "Gemini Models",
        description: "Models within this group: Gemini Flash, Gemini Pro",
        buckets: [
          { displayName: "5h Limit Remaining", window: "5h", resetTime: rollingReset, remainingFraction: 1 },
          { displayName: "Weekly Limit Remaining", window: "weekly", resetTime: weekReset, remainingFraction: 0.5 },
        ],
      },
    ],
  };
  report.untouchedReset = await readUsage(cli, "untouched rolling reset", 1, "gemini-3.8-flash-high");
  assert.deepEqual(
    report.untouchedReset.readings[0]?.rateLimits,
    {
      limitId: "antigravity",
      primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: null },
      secondary: { usedPercent: 50, windowDurationMins: 10_080, resetsAt: Date.parse(weekReset) / 1_000 },
    },
    "an unused quota shows no rolling reset, and a used quota keeps its reset",
  );

  service.quota = GOOGLE_QUOTA;
  report.apiKeySignIn = await readUsage(cli, "API key sign-in", 1, undefined, {
    ...NO_PROVIDER_CREDENTIALS,
    apiKey: (provider) => (provider === "antigravity" ? "fake-gemini-key" : null),
  });
  assertNoUsage(report.apiKeySignIn, []);

  await writeToken(ACCESS_TOKEN, new Date(Date.now() + 30_000).toISOString());
  report.expiringToken = await readUsage(cli, "token expires within a minute", 1);
  assertNoUsage(report.expiringToken, []);
  await writeToken("", "2000-01-01T00:00:00Z");
  report.importedToken = await readUsage(cli, "imported token", 1);
  assertNoUsage(report.importedToken, []);

  await writeToken(ACCESS_TOKEN, inOneHour());
  service.status = 403;
  report.forbidden = await readUsage(cli, "403", 1);
  assertNoUsage(report.forbidden, ["/v1internal:loadCodeAssist"]);

  service.status = 200;
  service.project = null;
  report.missingProject = await readUsage(cli, "no project", 1);
  assertNoUsage(report.missingProject, ["/v1internal:loadCodeAssist"]);

  report.passed = true;
} finally {
  for (const client of clients) await runCauseEffect(client.stop()).catch(() => undefined);
  await new Promise<void>((done) => server.close(() => done()));
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
