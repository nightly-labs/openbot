import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type AgentEvent } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/antigravity-verification-link-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-antigravity-verification-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const install = join(root, "antigravity");
const fakeAgy = join(install, "1.5.14", "bin", "antigravity");
const appData = join(home, ".gemini", "antigravity-acp");
const ACCESS_TOKEN = "fake-verification-access-token";
const GOOGLE_LINK =
  "https://accounts.google.com/signin/continue?sarp=1&scc=1&continue=https://developers.google.com/gemini-code-assist/auth/auth_success_gemini&plt=from-google";
const ANSWER_LINK = "https://accounts.google.com/signin/continue?sarp=1&scc=1&plt=from-answer";
const LOG_LINK = "https://accounts.google.com/v3/signin/continue?sarp=1&scc=1&plt=from-log";
const VALIDATION_LOG = `E 403 retrieveUserQuotaSummary ${JSON.stringify(
  JSON.stringify({
    error: {
      code: 403,
      status: "PERMISSION_DENIED",
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.ErrorInfo",
          reason: "VALIDATION_REQUIRED",
          domain: "cloudcode-pa.googleapis.com",
          metadata: { validation_url: LOG_LINK },
        },
      ],
    },
  }),
).replaceAll("&", "\\\\u0026")}\n`;
const VERIFY_MESSAGE = "Google must verify your account before Gemini can answer.";

process.env.HOME = home;
process.env.GEMINI_HOME = join(home, ".gemini");
process.env.OPENBOT_ANTIGRAVITY_PATH = fakeAgy;

const FAKE_AGY = `#!/usr/bin/env node
const NL = String.fromCharCode(10);
if (process.argv[2] === "--version") {
  process.stdout.write("1.5.14" + NL);
  process.exit(0);
}
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
const MODELS = ["gemini-verify"];
const models = { availableModels: MODELS.map((modelId) => ({ modelId, name: modelId })), currentModelId: MODELS[0] };
const update = (sessionId, value) => write({ method: "session/update", params: { sessionId, update: value } });
let sessions = 0;
function handle(message) {
  const params = message.params ?? {};
  if (message.id === undefined) return;
  if (message.method === "initialize")
    return write({ id: message.id, result: { protocolVersion: 1, authMethods: [], agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } } } });
  if (message.method === "session/new") return write({ id: message.id, result: { sessionId: "agy-" + process.pid + "-" + ++sessions, models } });
  if (message.method === "session/resume" || message.method === "session/load") return write({ id: message.id, result: { sessionId: params.sessionId, models } });
  if (message.method === "session/prompt") {
    const text = params.prompt.map((block) => block.text ?? "").join("");
    if (text.includes("WARN-VERIFY")) {
      update(params.sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: NL + "\\u26A0 Verification required. Please complete verification in your browser to continue." } });
      return write({ id: message.id, result: { stopReason: "end_turn" } });
    }
    if (text.includes("PLAIN-VERIFY")) {
      update(params.sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Please verify your account in your browser to continue:" + NL + ${JSON.stringify(ANSWER_LINK)} } });
      return write({ id: message.id, result: { stopReason: "end_turn" } });
    }
    if (text.includes("NORMAL-ANSWER")) {
      update(params.sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "The site says: " } });
      update(params.sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Verification required for new devices. Verify your account to raise the limit." } });
      return write({ id: message.id, result: { stopReason: "end_turn" } });
    }
    if (text.includes("RPC-VERIFY"))
      return write({ id: message.id, error: { code: -32603, message: "Internal error: Verification required. Please complete verification in your browser to continue." } });
    update(params.sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done." } });
    return write({ id: message.id, result: { stopReason: "end_turn" } });
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

interface CaseReport {
  name: string;
  googleNeedsValidation: boolean;
  status: string;
  error: { message: string; link: string | null } | null;
  loadCodeAssistCalls: number;
  passed: boolean;
}

const report: { cases: CaseReport[]; passed: boolean; error?: string } = { cases: [], passed: false };

let googleNeedsValidation = true;
let loadCodeAssistCalls = 0;
const codeAssist = createServer((request, response) => {
  if (request.url?.endsWith(":loadCodeAssist") && request.headers.authorization === `Bearer ${ACCESS_TOKEN}`) {
    loadCodeAssistCalls += 1;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify(
        googleNeedsValidation
          ? {
              ineligibleTiers: [
                { reasonCode: "INELIGIBLE_ACCOUNT", validationUrl: "https://example.com/not-google" },
                {
                  reasonCode: "VALIDATION_REQUIRED",
                  reasonMessage: "Verify your account to continue.",
                  validationUrl: GOOGLE_LINK,
                  validationUrlLinkText: "Verify your account",
                },
              ],
            }
          : { currentTier: { id: "free-tier" } },
      ),
    );
    return;
  }
  response.writeHead(404);
  response.end();
});
await new Promise<void>((done) => codeAssist.listen(0, "127.0.0.1", done));
const address = codeAssist.address();
assert.ok(address && typeof address === "object");
process.env.OPENBOT_DEV_ANTIGRAVITY_CODE_ASSIST_URL = `http://127.0.0.1:${address.port}/v1internal`;

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  toolCanUseTab: () => false,
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
  shareTab: () => undefined,
  unshareThread: () => undefined,
  agentTab: () => null,
};

async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

mkdirSync(home, { recursive: true });
await mkdir(join(install, "1.5.14", "bin"), { recursive: true });
await writeFile(fakeAgy, FAKE_AGY, { mode: 0o755 });
await mkdir(appData, { recursive: true });
await writeFile(
  join(appData, "antigravity-oauth-token"),
  JSON.stringify({
    token: { access_token: ACCESS_TOKEN, expiry: new Date(Date.now() + 3_600_000).toISOString() },
    auth_method: "consumer",
    id_token_email: "verify@example.com",
  }),
  { mode: 0o600 },
);
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "antigravity",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "antigravity"),
});
const events: AgentEvent[] = [];
agents.on("event", (event) => events.push(event));

const idle = (agentId: string) =>
  agents
    .listQueue(agentId)
    .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status));

async function runCase(name: string, text: string, needsValidation: boolean): Promise<CaseReport> {
  googleNeedsValidation = needsValidation;
  const agent = await runCauseEffect(
    agents.createAgent({
      name,
      description: "Checks the Gemini account verification link.",
      avatarSeed: name.replace(/[^a-z]+/gu, "-"),
      avatarHue: null,
      provider: "antigravity",
      model: "gemini-verify",
      initialMessage: "Hello.",
    }),
  );
  await waitFor(`${name}: the first turn`, () => idle(agent.id));
  const since = events.length;
  const callsBefore = loadCodeAssistCalls;
  const receipt = await runCauseEffect(agents.sendMessage({ agentId: agent.id, text }));
  const deliveryId = receipt.deliveries[0]?.id;
  assert.ok(deliveryId, `${name}: the message has a delivery`);
  const status = await waitFor(`${name}: the message to end`, () => {
    const value = mailbox.getDelivery(deliveryId)?.delivery.status;
    return value === "completed" || value === "failed" || value === "interrupted" ? value : null;
  });
  const error = await waitFor(`${name}: the error event`, () =>
    events.slice(since).find((event) => event.type === "error" && event.agentId === agent.id),
  );
  const result: CaseReport = {
    name,
    googleNeedsValidation: needsValidation,
    status,
    error: error.type === "error" ? { message: error.message, link: error.link ?? null } : null,
    loadCodeAssistCalls: loadCodeAssistCalls - callsBefore,
    passed: false,
  };
  report.cases.push(result);
  assert.equal(status, "failed", `${name}: the message fails`);
  assert.ok(result.error?.message.includes(VERIFY_MESSAGE), `${name}: the error asks to verify the account`);
  return result;
}

async function runNormalAnswer(name: string): Promise<CaseReport> {
  googleNeedsValidation = true;
  const agent = await runCauseEffect(
    agents.createAgent({
      name,
      description: "Checks that a normal answer is not an account verification.",
      avatarSeed: name.replace(/[^a-z]+/gu, "-"),
      avatarHue: null,
      provider: "antigravity",
      model: "gemini-verify",
      initialMessage: "Hello.",
    }),
  );
  await waitFor(`${name}: the first turn`, () => idle(agent.id));
  const since = events.length;
  const receipt = await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "NORMAL-ANSWER" }));
  const deliveryId = receipt.deliveries[0]?.id;
  assert.ok(deliveryId, `${name}: the message has a delivery`);
  const status = await waitFor(`${name}: the message to end`, () => {
    const value = mailbox.getDelivery(deliveryId)?.delivery.status;
    return value === "completed" || value === "failed" || value === "interrupted" ? value : null;
  });
  const error = events.slice(since).find((event) => event.type === "error" && event.agentId === agent.id);
  const result: CaseReport = {
    name,
    googleNeedsValidation: true,
    status,
    error: error?.type === "error" ? { message: error.message, link: error.link ?? null } : null,
    loadCodeAssistCalls: 0,
    passed: false,
  };
  report.cases.push(result);
  assert.equal(status, "completed", `${name}: a normal answer about verification completes`);
  assert.equal(result.error, null, `${name}: a normal answer shows no error`);
  return result;
}

try {
  await runCauseEffect(agents.initialize());

  const warning = await runCase("warning answer", "WARN-VERIFY", true);
  assert.equal(warning.error?.link, GOOGLE_LINK, "The Verify account button opens Google's verification page.");
  warning.passed = true;

  const plain = await runCase("plain answer with a link", "PLAIN-VERIFY", false);
  assert.equal(plain.error?.link, ANSWER_LINK, "Without a Google link, the button opens the link of the answer.");
  plain.passed = true;

  const preferred = await runCase("plain answer, Google link first", "PLAIN-VERIFY", true);
  assert.equal(preferred.error?.link, GOOGLE_LINK, "The current link from Google comes before the link of the answer.");
  preferred.passed = true;

  const rpc = await runCase("JSON-RPC error", "RPC-VERIFY", true);
  assert.equal(rpc.error?.link, GOOGLE_LINK, "A refused prompt also gets the Verify account button.");
  rpc.passed = true;

  await mkdir(join(appData, "log"), { recursive: true });
  await writeFile(join(appData, "log", "antigravity.log"), VALIDATION_LOG);
  const logged = await runCase("link in the Antigravity log", "WARN-VERIFY", false);
  assert.equal(logged.error?.link, LOG_LINK, "A /v3/signin link from the Antigravity log opens the verification page.");
  logged.passed = true;

  const normal = await runNormalAnswer("normal answer about verification");
  normal.passed = true;

  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  codeAssist.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
