import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type AgentModelOption, analyticsRange, isAgentModel, WORKFLOWS_USAGE_ID } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { ProfileClients } from "../src/backend/agent/profile-clients";
import { workflowUsageObserver } from "../src/backend/agent/usage-collection";
import { WarmGenerations } from "../src/backend/agent/warm-generations";
import { workflowGenerationError } from "../src/backend/agent/workflow-generation-error";
import type { AgentClient } from "../src/backend/agent-client";
import type { AgentCliInfo } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";

const OUT = resolve(import.meta.dirname, "../.openbot-build/workflow-model-steps-e2e");

const FAKE_AGY = `#!/usr/bin/env node
const fs = require("node:fs");
const NL = String.fromCharCode(10);
if (process.argv[2] === "--version") {
  process.stdout.write("1.5.4" + NL);
  process.exit(0);
}
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
let sessions = 0;
function handle(message) {
  if (message.method) fs.appendFileSync(process.env.FAKE_AGY_LOG, JSON.stringify({
    pid: process.pid, method: message.method, sessionId: message.params && message.params.sessionId,
    images: message.method === "session/prompt"
      ? message.params.prompt.filter((block) => block.type === "image").map((block) => ({ mimeType: block.mimeType, data: block.data }))
      : undefined,
  }) + NL);
  if (message.id === undefined) return;
  if (message.method === "initialize") {
    const promptCapabilities = { image: fs.existsSync(process.env.FAKE_AGY_LOG + ".image") };
    write({ id: message.id, result: { protocolVersion: 1, agentCapabilities: { promptCapabilities }, authMethods: [] } });
    return;
  }
  if (message.method === "session/new") {
    write({ id: message.id, result: {
      sessionId: process.pid + "-" + ++sessions,
      models: { availableModels: [{ modelId: "gemini-fake", name: "Gemini Fake" }], currentModelId: "gemini-fake" },
    } });
    return;
  }
  if (message.method === "session/prompt") {
    const text = message.params.prompt.map((block) => block.text).join("");
    if (text.includes("FAIL")) {
      write({ id: message.id, error: { code: -32603, message: "The fake model failed." } });
      return;
    }
    write({ method: "session/update", params: {
      sessionId: message.params.sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ok" } },
    } });
    write({ id: message.id, result: { stopReason: "end_turn", usage: {
      inputTokens: 100, outputTokens: 10, thoughtTokens: 5, cachedReadTokens: 0, cachedWriteTokens: 0, totalTokens: 115,
    } } });
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
  pid: number;
  method: string;
  sessionId?: string;
  images?: { mimeType: string; data: string }[];
}

interface Report {
  checks: string[];
  processes: number[][];
  usage?: unknown;
  passed: boolean;
  failure?: string;
}

const report: Report = { checks: [], processes: [], passed: false };
const check = (name: string, ok: boolean, detail?: unknown) => {
  assert.ok(ok, `${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  report.checks.push(name);
};

const root = await mkdtemp(join(tmpdir(), "openbot-workflow-model-steps-e2e-"));
const log = join(root, "agy.jsonl");
process.env.FAKE_AGY_LOG = log;
process.env.GEMINI_HOME = join(root, "gemini");
const database = new OpenBotDatabase(join(root, "profile"));
const clients: AgentClient[] = [];

async function readLog(): Promise<LogEntry[]> {
  const text = await readFile(log, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function promptProcesses(): Promise<number[]> {
  return (await readLog()).filter((entry) => entry.method === "session/prompt").map((entry) => entry.pid);
}

async function warmProcesses(): Promise<number[]> {
  const entries = await readLog();
  const prompted = new Set(entries.filter((entry) => entry.method === "session/prompt").map((entry) => entry.pid));
  return entries.filter((entry) => entry.method === "initialize" && !prompted.has(entry.pid)).map((entry) => entry.pid);
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function ended(pid: number): Promise<boolean> {
  for (let tries = 0; tries < 200 && alive(pid); tries++) await new Promise((done) => setTimeout(done, 25));
  return !alive(pid);
}

try {
  await Effect.runPromise(database.initialize());
  const executable = join(root, "agy", "1.5.4", "bin", "antigravity");
  await mkdir(join(root, "agy", "1.5.4", "bin"), { recursive: true });
  await writeFile(executable, FAKE_AGY);
  await chmod(executable, 0o755);
  const cli: AgentCliInfo = { executable, version: "1.5.4", source: "managed" };
  const driver = requireProviderDriver("antigravity");
  const modelId = "gemini-fake";
  assert.ok(isAgentModel(modelId));
  const model: AgentModelOption = {
    provider: "antigravity",
    id: modelId,
    name: "Gemini Fake",
    description: "",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["medium"],
  };

  let owner: AgentClient = driver.createClient(cli, 10_000, NO_PROVIDER_CREDENTIALS);
  const profileClients = new ProfileClients();
  const warm = new WarmGenerations({
    ownerFor: () => owner,
    createClient: () => {
      const client = (driver.createProfileClient ?? driver.createClient)(cli, 10_000, NO_PROVIDER_CREDENTIALS);
      clients.push(client);
      return client;
    },
    profileClients,
  });
  const step = (prompt: string) =>
    runCauseEffect(
      warm.generate("antigravity", model, prompt, workflowUsageObserver(database.usage, "antigravity", modelId)),
    );

  check("the first step answers", (await step("Say ok.")) === "ok");
  check("the second step answers", (await step("Say ok again.")) === "ok");
  const first = await promptProcesses();
  report.processes.push(first);
  check("each step runs on a process of its own", first.length === 2 && first[0] !== first[1], first);
  check("the process of each step ends after its step", (await Promise.all(first.map(ended))).every(Boolean), first);
  const entries = await readLog();
  const prompted = entries.filter((entry) => entry.method === "session/prompt").map((entry) => entry.sessionId);
  check("each step starts its own session", new Set(prompted).size === 2, prompted);
  const warmFirst = await warmProcesses();
  check("the warm process starts once", warmFirst.length === 1, warmFirst);

  const firstPid = warmFirst[0] ?? 0;
  await runCauseEffect(warm.ownerStopped(owner));
  check("the old process ends when its main client stops", await ended(firstPid));
  owner = driver.createClient(cli, 10_000, NO_PROVIDER_CREDENTIALS);
  check("a step after a new main client answers", (await step("Say ok.")) === "ok");
  const second = await warmProcesses();
  const secondPid = second.at(-1) ?? 0;
  check("the step after a new main client runs on a new process", secondPid !== firstPid, second);

  const failed = await runCauseEffect(
    warm.generate("antigravity", model, "FAIL", workflowUsageObserver(database.usage, "antigravity", modelId)),
  ).then(
    () => false,
    () => true,
  );
  check("a failed step fails", failed);
  const failedStep = (await promptProcesses()).at(-1) ?? 0;
  check("a failed step stops its process", (await ended(secondPid)) && (await ended(failedStep)));
  check("a step after a failed step answers", (await step("Say ok.")) === "ok");
  const third = await warmProcesses();
  const thirdPid = third.at(-1) ?? 0;
  check("the step after a failed step runs on a new process", thirdPid !== secondPid, third);
  report.processes.push(second, third);

  await runCauseEffect(warm.dispose());
  check("shutdown stops the warm process", await ended(thirdPid));

  const usage = database.usage.readHost(analyticsRange(WORKFLOWS_USAGE_ID, 1));
  const all = database.usage.readHost((({ agentId: _agentId, ...range }) => range)(analyticsRange("", 1)));
  report.usage = { workflows: usage.totals, agents: all.agents, models: all.models };
  check(
    "the host report has one row, the Workflows row",
    all.agents.length === 1 && all.agents[0]?.agentId === WORKFLOWS_USAGE_ID,
    all.agents,
  );
  check(
    "the Workflows row counts the tokens of the four answered steps",
    usage.totals.uncachedInput === 400 && usage.totals.output === 60,
    usage.totals,
  );
  check(
    "the model row names the provider and the model",
    all.models.length === 1 && all.models[0]?.provider === "antigravity" && all.models[0]?.model === modelId,
    all.models,
  );

  const picture = join(root, "picture.png");
  const pictureBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await writeFile(picture, pictureBytes);
  const pictureStep = async (prompt: string) => {
    const pictures = new WarmGenerations({
      ownerFor: () => owner,
      createClient: () => {
        const client = (driver.createProfileClient ?? driver.createClient)(cli, 10_000, NO_PROVIDER_CREDENTIALS);
        clients.push(client);
        return client;
      },
      profileClients,
    });
    try {
      return await runCauseEffect(pictures.generate("antigravity", model, prompt, undefined, [picture])).then(
        (text) => ({ text, error: null }),
        (cause: unknown) => ({ text: null, error: workflowGenerationError(cause, "antigravity") }),
      );
    } finally {
      await runCauseEffect(pictures.dispose());
    }
  };
  const sentPictures = async () => (await readLog()).flatMap((entry) => entry.images ?? []);

  const refused = await pictureStep("Describe the picture.");
  check(
    "a model that cannot read pictures fails the step with a clear reason",
    refused.error === sourceText("error.workflow.modelImageUnsupported"),
    refused,
  );
  check("a model that cannot read pictures gets no prompt", (await sentPictures()).length === 0);

  await writeFile(`${log}.image`, "");
  const seen = await pictureStep("Describe the picture.");
  check("a model that can read pictures answers", seen.text === "ok", seen);
  const sent = await sentPictures();
  check(
    "the model gets the picture as an image block",
    sent.length === 1 && sent[0]?.mimeType === "image/png" && sent[0]?.data === pictureBytes.toString("base64"),
    sent.map((image) => image.mimeType),
  );
  check(
    "a step with no picture still runs on a model that can read pictures",
    (await step("Say ok.")) === "ok" && (await sentPictures()).length === 1,
  );

  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  for (const client of clients) await runCauseEffect(client.stop()).catch(() => undefined);
  database.close();
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
