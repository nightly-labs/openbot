// Runs custom ACP agents end to end on the real modules: the encrypted agent store, Check agent, and
// the `acp` provider driver with its router over real agent processes. Two fake agents speak ACP over
// stdio and give the same session id, so the router must keep them apart. A usage prompt goes to the
// model list process of its agent, and its answer comes back redacted. A fake cipher replaces the
// operating system's secret storage, which exists only in Electron.
// `bun scripts/custom-acp-agent-e2e.ts`. Writes .openbot-build/custom-acp-agent-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CUSTOM_AGENT_DEFAULT_MODEL } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { checkAcpAgent } from "../src/backend/acp-agent-check";
import { isMissingProviderSessionError } from "../src/backend/agent/thread-items";
import type { AgentClient } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { CustomAgentStore } from "../src/main/custom-agent-store";
import { installFakeAgent, readJsonl, runTurn, startThread, stopClients, xorCipher } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/custom-acp-agent-e2e");
const SECRET = "sk-e2e-agent-secret";
// A routed thread id is `<agent>:<folder tag>:<session>`; the folder tag is 12 hex digits.
const ROUTED_THREAD = (agent: string) => new RegExp(`^${agent}:[0-9a-f]{12}:s-\\d+$`);

interface LogEntry {
  pid: number;
  token: string | null;
  event: "start" | "request";
  method?: string;
  sessionId?: string | null;
}

interface Report {
  passed: boolean;
  save?: { agents: string[]; secretOnDisk: boolean; secretInSummary: boolean };
  check?: { agentName: string | null; version: string | null; requests: string[]; stopped: boolean };
  checkModels?: { models: string[]; requests: string[]; stopped: boolean; signInModels: string[] };
  crashMasked?: { message: string };
  turns?: { models: string[]; alphaThread: string; betaThread: string; alphaReply: string; betaReply: string };
  usage?: { answer: string | null; threadProcesses: number; usageProcess: number };
  restart?: { processesStopped: number; loadedSession: string | null | undefined; resumedReply: string };
  switch?: { missingSession: boolean };
  delete?: { refused: string };
}

const root = await mkdtemp(join(tmpdir(), "openbot-custom-agent-e2e-"));
const report: Report = { passed: false };
const clients: AgentClient[] = [];

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The agent's own session id in a routed thread id. */
function sessionOf(thread: string): string | undefined {
  return thread.split(":").at(-1);
}

/** Runs a turn that must succeed and answers its reply. */
async function reply(client: AgentClient, thread: string, model: string, text: string): Promise<string> {
  const turn = await runTurn(client, thread, { model, text });
  assert.equal(turn.error, null, `The turn on ${model} succeeds.`);
  return turn.reply;
}

try {
  const executable = join(root, "bin", "fake-acp-agent");
  const workspace = join(root, "workspace");
  const alphaLog = join(root, "alpha.jsonl");
  const betaLog = join(root, "beta.jsonl");
  await mkdir(workspace);
  await installFakeAgent(executable, "custom-acp");

  // 1. Save two agents. The secret is encrypted on disk and is in no summary.
  const store = new CustomAgentStore({ path: join(root, "custom-agents.json"), cipher: xorCipher });
  await runCauseEffect(store.load());
  await runCauseEffect(
    store.save({
      id: "alpha",
      name: "Alpha",
      command: executable,
      args: ["--acp"],
      env: [
        { name: "FAKE_LOG", value: alphaLog },
        { name: "FAKE_TITLE", value: "Alpha" },
        { name: "FAKE_MODELS", value: "1" },
        { name: "FAKE_TOKEN", value: SECRET },
      ],
      usagePrompt: "/usage",
    }),
  );
  await runCauseEffect(
    store.save({
      id: "beta",
      name: "Beta",
      command: executable,
      args: [],
      env: [
        { name: "FAKE_LOG", value: betaLog },
        { name: "FAKE_TITLE", value: "Beta" },
      ],
      usagePrompt: null,
    }),
  );
  const file = await readFile(join(root, "custom-agents.json"), "utf8");
  assert.ok(!file.includes(SECRET), "The agent file holds no plain env value.");
  const summaries = await Effect.runPromise(store.list());
  assert.ok(!JSON.stringify(summaries).includes(SECRET), "A summary holds no env value.");
  assert.deepEqual(summaries.find((agent) => agent.id === "alpha")?.envNames, [
    "FAKE_LOG",
    "FAKE_TITLE",
    "FAKE_MODELS",
    "FAKE_TOKEN",
  ]);
  assert.equal(summaries.find((agent) => agent.id === "alpha")?.usagePrompt, "/usage", "The usage prompt is saved.");
  assert.equal(
    store.configs().find((agent) => agent.id === "beta")?.usagePrompt,
    null,
    "An agent with no usage prompt has none.",
  );
  report.save = { agents: summaries.map((agent) => agent.id), secretOnDisk: false, secretInSummary: false };

  // 2. An install check: `initialize` only, then the process is gone.
  const checkLog = join(root, "check.jsonl");
  const check = await runCauseEffect(
    checkAcpAgent({
      executable,
      args: ["--acp"],
      env: { FAKE_LOG: checkLog, FAKE_TITLE: "Alpha", FAKE_TOKEN: SECRET },
    }),
  );
  assert.equal(check.agentName, "Alpha");
  assert.equal(check.version, "1.2.3");
  const checkEntries = await readJsonl<LogEntry>(checkLog);
  assert.deepEqual(
    checkEntries.filter((entry) => entry.event === "request").map((entry) => entry.method),
    ["initialize"],
  );
  const checkPid = checkEntries[0]?.pid ?? 0;
  assert.equal(isRunning(checkPid), false, "Check agent stops the process.");
  const crash = await runCauseEffect(
    checkAcpAgent({
      executable,
      args: [],
      env: { FAKE_LOG: checkLog, FAKE_CRASH: "1", FAKE_TOKEN: SECRET },
      timeoutMs: 5_000,
    }),
  ).catch((error: unknown) => error);
  assert.ok(crash instanceof Error, "A crashing agent fails the check.");
  assert.ok(!crash.message.includes(SECRET), "The check error masks the agent's env value.");
  assert.deepEqual(check.models, [], "An install check opens no session, so it lists no models.");
  report.check = { agentName: check.agentName, version: check.version, requests: ["initialize"], stopped: true };
  report.crashMasked = { message: crash.message };

  // 2b. Check agent from Settings: one session in the empty folder lists the models, then the process
  // is gone. An agent that refuses the session until sign-in still passes, with no models.
  const modelsLog = join(root, "check-models.jsonl");
  const listed = await runCauseEffect(
    checkAcpAgent({
      executable,
      args: ["--acp"],
      env: { FAKE_LOG: modelsLog, FAKE_TITLE: "Alpha", FAKE_MODELS: "1", FAKE_TOKEN: SECRET },
      listModels: true,
    }),
  );
  assert.deepEqual(listed.models, ["Fast", "Deep"]);
  const modelsEntries = await readJsonl<LogEntry>(modelsLog);
  const modelsRequests = modelsEntries.filter((entry) => entry.event === "request").map((entry) => entry.method ?? "");
  assert.deepEqual(modelsRequests, ["initialize", "session/new"]);
  assert.equal(isRunning(modelsEntries[0]?.pid ?? 0), false, "Check agent stops the process after the models.");
  const signIn = await runCauseEffect(
    checkAcpAgent({
      executable,
      args: ["--acp"],
      env: { FAKE_LOG: modelsLog, FAKE_TITLE: "Alpha", FAKE_SIGN_IN: "1", FAKE_TOKEN: SECRET },
      listModels: true,
    }),
  );
  assert.equal(signIn.agentName, "Alpha", "An agent that needs sign-in still passes the check.");
  assert.deepEqual(signIn.models, []);
  report.checkModels = { models: listed.models, requests: modelsRequests, stopped: true, signInModels: signIn.models };

  // 3. The router: one process per agent, the models of both, and equal session ids kept apart.
  const driver = requireProviderDriver("acp");
  const context = {
    apiKey: () => null,
    customProviders: () => [],
    mcpServers: () => [],
    customAgents: () => store.configs(),
  };
  const cli = await runCauseEffect(driver.resolveCli());
  const open = () => {
    const client = driver.createClient(cli, 20_000, context, undefined);
    clients.push(client);
    client.start();
    return client;
  };
  let client = open();
  const models = await runCauseEffect(client.request("model/list", {}, (value) => value));
  const modelIds = JSON.stringify(models);
  for (const id of ["alpha/fast", "alpha/deep", "beta/default"]) assert.ok(modelIds.includes(`"${id}"`), id);

  const alphaThread = await startThread(client, { model: "alpha/deep", cwd: workspace });
  const betaThread = await startThread(client, { model: "beta/default", cwd: workspace });
  assert.match(alphaThread, ROUTED_THREAD("alpha"));
  assert.match(betaThread, ROUTED_THREAD("beta"));
  assert.equal(sessionOf(alphaThread), sessionOf(betaThread), "Both agents give the same session id.");

  const alphaReply = await reply(client, alphaThread, "alpha/deep", "hello alpha");
  const betaReply = await reply(client, betaThread, "beta/default", "hello beta");
  assert.match(alphaReply, /^Alpha heard: .*hello alpha$/);
  assert.match(betaReply, /^Beta heard: .*hello beta$/);
  const alphaEntries = await readJsonl<LogEntry>(alphaLog);
  assert.ok(
    alphaEntries.every((entry) => entry.token === SECRET),
    "The agent process gets its env value.",
  );
  assert.equal((await readJsonl<LogEntry>(betaLog)).find((entry) => entry.event === "start")?.token, null);
  report.turns = {
    models: ["alpha/fast", "alpha/deep", "beta/default"],
    alphaThread,
    betaThread,
    alphaReply,
    betaReply,
  };

  // 3b. Usage: the prompt runs in a session that no thread owns, on the model list process, and the
  // answer hides the env value that the agent echoes.
  assert.ok(client.readUsageText, "The router reads usage text.");
  const promptPids = (entries: LogEntry[]) =>
    new Set(entries.filter((entry) => entry.method === "session/prompt").map((entry) => entry.pid));
  const threadPids = promptPids(await readJsonl<LogEntry>(alphaLog));
  const usageAnswer = await runCauseEffect(
    client.readUsageText(`alpha/${CUSTOM_AGENT_DEFAULT_MODEL}`, `/usage ${SECRET}`),
  );
  // Each env value is redacted, so the title in `FAKE_TITLE` is too.
  assert.equal(usageAnswer, "[redacted] heard: /usage [redacted]", "The answer is the agent's, redacted.");
  const usagePids = [...promptPids(await readJsonl<LogEntry>(alphaLog))].filter((pid) => !threadPids.has(pid));
  assert.equal(usagePids.length, 1, "The usage prompt runs on a process that serves no thread.");
  report.usage = { answer: usageAnswer, threadProcesses: threadPids.size, usageProcess: usagePids.length };

  // 4. Restart: a new router loads the saved session on a new process and runs a turn on it.
  const pidsBefore = [...new Set([...alphaEntries, ...(await readJsonl<LogEntry>(betaLog))].map((entry) => entry.pid))];
  await runCauseEffect(client.stop());
  assert.ok(
    pidsBefore.every((pid) => !isRunning(pid)),
    "Stopping the router stops every agent process.",
  );
  client = open();
  await runCauseEffect(
    client.request("thread/resume", { threadId: alphaThread, model: "alpha/deep", cwd: workspace }, (v) => v),
  );
  const loaded = (await readJsonl<LogEntry>(alphaLog)).filter((entry) => entry.method === "session/load");
  assert.equal(loaded.at(-1)?.sessionId, sessionOf(alphaThread), "The agent loads its own session id.");
  const resumedReply = await reply(client, alphaThread, "alpha/deep", "after restart");
  assert.match(resumedReply, /after restart$/);
  report.restart = { processesStopped: pidsBefore.length, loadedSession: loaded.at(-1)?.sessionId, resumedReply };

  // 5. Switch: a turn on another agent's model reads as a missing session, so the runtime hands over.
  const switched = await runCauseEffect(
    client.request("turn/start", { threadId: alphaThread, model: "beta/default", input: [] }, (v) => v),
  ).catch((error: unknown) => error);
  assert.equal(isMissingProviderSessionError(switched, "acp"), true);
  report.switch = { missingSession: true };

  // 6. Delete: the agent's models are refused, and the other agent still works.
  await runCauseEffect(store.remove("beta"));
  const deleted = await startThread(client, { model: "beta/default", cwd: workspace }).catch((error: unknown) => error);
  assert.ok(deleted instanceof Error && /not saved now/.test(deleted.message), String(deleted));
  assert.match(await reply(client, alphaThread, "alpha/deep", "still here"), /still here$/);
  report.delete = { refused: deleted.message };

  report.passed = true;
} finally {
  await stopClients(clients);
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
