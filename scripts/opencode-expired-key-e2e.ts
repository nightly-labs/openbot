import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sourceText } from "@openbot/i18n/source";
import type { AgentClient } from "../src/backend/agent-client";
import type { AgentCliInfo } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { CustomProviderConfig } from "../src/backend/opencode-config";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { installFakeAgent, readJsonl, runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-expired-key-e2e");

interface LogEntry {
  event: "spawn" | "load" | "prompt";
  configKey?: string | null;
  baseURL?: string | null;
  zenKey?: string | null;
  envKey?: string | null;
  imageTool?: boolean | null;
  videoTool?: boolean | null;
  sessionId?: string;
  key?: string | null;
}

interface Report {
  passed: boolean;
  expired?: { error: string };
  replaced?: { thread: string; loaded: boolean; key: string | null; zenKey: string | null; envKey: string | null };
  noStoredKey?: { configKey: string | null; key: string | null };
  endpoint?: { baseURL: string | null; zenKey: string | null };
  authRequired?: { error: string };
  refusedV2?: { saved: string; notSaved: string; refused401: string | null; refused403: string | null };
  providerRefused?: { error: string };
  inheritedEnvKey?: { envKey: string | null; configKey: string | null };
  ownGoKey?: { error: string };
  sameGoKey?: { error: string };
  mediaTools?: {
    goKeyOnly: (boolean | null)[];
    otherProviderEnvKey: (boolean | null)[];
    textProviderEnvKey: (boolean | null)[];
    customProviderKey: (boolean | null)[];
    textCustomProviderKey: (boolean | null)[];
    userConfigKey: (boolean | null)[];
    otherProviderKey: (boolean | null)[];
  };
}

const root = await mkdtemp(join(tmpdir(), "openbot-opencode-expired-key-e2e-"));
const log = join(root, "opencode.jsonl");
const report: Report = { passed: false };
const clients: AgentClient[] = [];
let storedKey: string | null = "expired";
let endpoints: CustomProviderConfig[] = [];
process.env.FAKE_LOG = log;
process.env.FAKE_AUTH_KEY = "expired";
const openCodeData = join(root, "data", "opencode");
process.env.XDG_DATA_HOME = join(root, "data");
process.env.XDG_CONFIG_HOME = join(root, "config");
delete process.env.OPENCODE_CONFIG;
delete process.env.OPENCODE_CONFIG_DIR;
delete process.env.OPENCODE_AUTH_CONTENT;
delete process.env.OPENCODE_DB;
for (const name of Object.keys(process.env)) if (name.endsWith("_API_KEY")) delete process.env[name];

function seedOpenCodeCatalog() {
  const models = (type: string) => ({ m: { type } });
  const body = {
    opencode: { env: ["OPENCODE_API_KEY"], models: { ...models("chat"), image: { type: "image" } } },
    openai: { env: ["OPENAI_API_KEY"], models: { ...models("chat"), image: { type: "image" } } },
    anthropic: { env: ["ANTHROPIC_API_KEY"], models: models("chat") },
    deepseek: { env: ["DEEPSEEK_API_KEY"], models: models("chat") },
  };
  const catalog = new DatabaseSync(join(openCodeData, "opencode.db"));
  catalog.exec("CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const insert = catalog.prepare("INSERT INTO kv (key, value) VALUES (?, ?)");
  insert.run("models-dev:v3:catalog", JSON.stringify({ updatedAt: 1, digest: "d1", body: JSON.stringify(body) }));
  insert.run("models-dev:v3:catalog:meta", JSON.stringify({ updatedAt: 1, digest: "d1" }));
  catalog.close();
}

function open(cli: AgentCliInfo): AgentClient {
  const client = requireProviderDriver("opencode").createClient(cli, 10_000, {
    ...NO_PROVIDER_CREDENTIALS,
    apiKey: (provider) => (provider === "opencode" ? storedKey : null),
    customProviders: () => endpoints,
  });
  clients.push(client);
  client.start();
  return client;
}

try {
  const executable = join(root, "opencode", "bin", "opencode");
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  await installFakeAgent(executable, "opencode-expired-key");
  await mkdir(openCodeData, { recursive: true });
  seedOpenCodeCatalog();
  const cli: AgentCliInfo = { executable, version: "1.18.30", source: "managed" };

  const first = open(cli);
  const thread = await startThread(first, { cwd: workspace });
  const { error } = await runTurn(first, thread);
  assert.equal(error, sourceText("error.provider.opencodeKeyExpired"), "An expired key names its own fix.");
  report.expired = { error };

  await runCauseEffect(first.stop());
  storedKey = "fresh";
  const second = open(cli);
  await runCauseEffect(second.request("thread/resume", { threadId: thread, cwd: workspace }, (value) => value));
  assert.equal((await runTurn(second, thread)).error, null, "The turn on the replaced key succeeds.");
  const entries = await readJsonl<LogEntry>(log);
  const prompt = entries.filter((entry) => entry.event === "prompt" && entry.sessionId === thread).at(-1);
  assert.equal(prompt?.key, "fresh", "The stored key wins over the key in auth.json.");
  const loaded = entries.some((entry) => entry.event === "load" && entry.sessionId === thread);
  assert.ok(loaded, "The new process loads the same thread.");
  const keySpawn = entries.filter((entry) => entry.event === "spawn").at(-1);
  assert.equal(keySpawn?.zenKey, null, "The free tier gets no stored key (#7550).");
  assert.equal(keySpawn?.envKey, null, "OPENCODE_API_KEY does not carry the stored key (#7550).");
  const goKeyOnly = [keySpawn?.imageTool ?? null, keySpawn?.videoTool ?? null];
  assert.deepEqual(
    goKeyOnly,
    [false, false],
    "With only an OpenCode Go key, OpenCode's image and video tools are off: they would fail (#15281).",
  );
  report.replaced = {
    thread,
    loaded,
    key: prompt?.key ?? null,
    zenKey: keySpawn?.zenKey ?? null,
    envKey: keySpawn?.envKey ?? null,
  };
  await runCauseEffect(second.stop());

  const mediaToolsOfNewProcess = async () => {
    await rm(log, { force: true });
    const client = open(cli);
    await startThread(client, { cwd: workspace });
    await runCauseEffect(client.stop());
    const spawn = (await readJsonl<LogEntry>(log)).find((entry) => entry.event === "spawn");
    return [spawn?.imageTool ?? null, spawn?.videoTool ?? null];
  };

  process.env.OPENAI_API_KEY = "other-provider";
  const otherProviderEnvKey = await mediaToolsOfNewProcess().finally(() => {
    delete process.env.OPENAI_API_KEY;
  });
  assert.deepEqual(
    otherProviderEnvKey,
    [null, null],
    "A provider key in the environment keeps the image and video tools.",
  );

  process.env.DEEPSEEK_API_KEY = "text-provider";
  const textProviderEnvKey = await mediaToolsOfNewProcess().finally(() => {
    delete process.env.DEEPSEEK_API_KEY;
  });
  assert.deepEqual(
    textProviderEnvKey,
    [false, false],
    "A key for a provider with no image or video models does not keep the tools (#17402).",
  );

  endpoints = [
    {
      id: "openai",
      name: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "endpoint-key",
      models: [{ id: "gpt", name: "GPT" }],
      headers: [],
    },
  ];
  const customProviderKey = await mediaToolsOfNewProcess().finally(() => {
    endpoints = [];
  });
  assert.deepEqual(
    customProviderKey,
    [null, null],
    "A custom provider with a key keeps the image and video tools: OpenCode adds its catalog image models.",
  );

  endpoints = [
    {
      id: "amin",
      name: "Amin",
      baseUrl: "https://llm.example.com/v1",
      apiKey: "endpoint-key",
      models: [{ id: "manageit/qwen3.8-27b", name: "Qwen" }],
      headers: [],
    },
  ];
  const textCustomProviderKey = await mediaToolsOfNewProcess().finally(() => {
    endpoints = [];
  });
  assert.deepEqual(
    textCustomProviderKey,
    [false, false],
    "A custom provider with a key but no catalog image models does not keep the tools (#17402).",
  );

  const userConfig = join(root, "config", "opencode", "opencode.json");
  await mkdir(join(root, "config", "opencode"), { recursive: true });
  await writeFile(userConfig, JSON.stringify({ provider: { openai: { options: { apiKey: "user-key" } } } }));
  const userConfigKey = await mediaToolsOfNewProcess().finally(() => rm(userConfig, { force: true }));
  assert.deepEqual(
    userConfigKey,
    [null, null],
    "A provider key in the user's own OpenCode config keeps the image and video tools.",
  );

  storedKey = null;
  process.env.FAKE_AUTH_KEY = "own";
  await rm(log, { force: true });
  const third = open(cli);
  const ownThread = await startThread(third, { cwd: workspace });
  assert.equal((await runTurn(third, ownThread)).error, null, "The turn on the user's own key succeeds.");
  const own = await readJsonl<LogEntry>(log);
  const spawn = own.find((entry) => entry.event === "spawn");
  assert.equal(spawn?.configKey, null, "With no stored key, OpenBot sends no key in the config.");
  const ownPrompt = own.find((entry) => entry.event === "prompt");
  assert.equal(ownPrompt?.key, "own", "The user's own key is used.");
  report.noStoredKey = { configKey: spawn?.configKey ?? null, key: ownPrompt?.key ?? null };
  await runCauseEffect(third.stop());

  storedKey = "fresh";
  endpoints = [
    {
      id: "opencode-go",
      name: "Local",
      baseUrl: "http://127.0.0.1:1234/v1",
      apiKey: null,
      models: [{ id: "m", name: "M" }],
      headers: [],
    },
  ];
  await rm(log, { force: true });
  await startThread(open(cli), { cwd: workspace });
  const endpointSpawn = (await readJsonl<LogEntry>(log)).find((entry) => entry.event === "spawn");
  assert.ok(endpointSpawn, "The fake OpenCode started.");
  assert.equal(endpointSpawn.baseURL, "http://127.0.0.1:1234/v1", "The endpoint keeps its URL.");
  assert.equal(endpointSpawn.configKey, null, "The stored key does not replace the endpoint's options.");
  assert.equal(endpointSpawn.zenKey, null, "The free tier gets no stored key (#7550).");
  report.endpoint = { baseURL: endpointSpawn.baseURL ?? null, zenKey: endpointSpawn.zenKey ?? null };

  storedKey = null;
  endpoints = [];
  process.env.FAKE_PROVIDER_AUTH = "1";
  const fifth = open(cli);
  const { error: authError } = await runTurn(fifth, await startThread(fifth, { cwd: workspace }));
  assert.equal(
    authError,
    sourceText("error.provider.opencodeAuthRequired", { provider: "anthropic" }),
    "A provider with no sign-in names itself and its fix.",
  );
  report.authRequired = { error: authError };

  delete process.env.FAKE_PROVIDER_AUTH;
  storedKey = "expired-v2";
  const sixth = open(cli);
  const { error: saved } = await runTurn(sixth, await startThread(sixth, { cwd: workspace }));
  assert.equal(saved, sourceText("error.provider.opencodeKeyRefused"), "A refused saved key names its fix.");
  await mkdir(openCodeData, { recursive: true });
  const sessions = new DatabaseSync(join(openCodeData, "opencode.db"));
  sessions.exec(
    "CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, seq INTEGER, data TEXT)",
  );
  const refusal = async (status: number) => {
    const session = await startThread(sixth, { cwd: workspace });
    const error = { type: "provider.auth", message: "refused", status, response: { body: "{}" } };
    const insert = sessions.prepare(
      "INSERT INTO session_message (id, session_id, type, seq, data) VALUES (?, ?, ?, ?, ?)",
    );
    insert.run(`${session}-1`, session, "user", 1, JSON.stringify({ text: "Say hi" }));
    insert.run(`${session}-2`, session, "idle", 2, JSON.stringify({ outcome: "failed", error }));
    return (await runTurn(sixth, session)).error;
  };
  let refused401: string | null;
  let refused403: string | null;
  try {
    refused401 = await refusal(401);
    assert.equal(refused401, sourceText("error.provider.opencodeKeyRefused"), "A 401 names the refused key.");
    refused403 = await refusal(403);
    assert.equal(
      refused403,
      sourceText("error.provider.opencodeGoRequestRefused"),
      "A 403 with a saved key does not ask for a new key.",
    );
  } finally {
    sessions.close();
  }
  await runCauseEffect(sixth.stop());
  storedKey = null;
  process.env.FAKE_AUTH_KEY = "expired-v2";
  await mkdir(openCodeData, { recursive: true });
  await writeFile(
    join(openCodeData, "auth.json"),
    JSON.stringify({ "opencode-go": { type: "api", key: "expired-v2" } }),
  );
  const seventh = open(cli);
  const { error: notSaved } = await runTurn(seventh, await startThread(seventh, { cwd: workspace }));
  assert.equal(
    notSaved,
    sourceText("error.provider.opencodeAuthRequired", { provider: "opencode-go" }),
    "With no saved key, the error stays the missing sign-in.",
  );
  report.refusedV2 = { saved, notSaved, refused401, refused403 };
  await runCauseEffect(seventh.stop());

  const database = new DatabaseSync(join(openCodeData, "opencode.db"));
  database.exec(
    "CREATE TABLE credential (id TEXT PRIMARY KEY, integration_id TEXT, label TEXT NOT NULL, value TEXT NOT NULL, active INTEGER, time_created INTEGER NOT NULL DEFAULT 0)",
  );
  database
    .prepare("INSERT INTO credential (id, integration_id, label, value, active) VALUES (?, ?, ?, ?, ?)")
    .run("cred_1", "anthropic", "API key", JSON.stringify({ type: "key", key: "valid" }), 1);
  database.close();
  process.env.FAKE_PROVIDER_AUTH = "1";
  const eighth = open(cli);
  const { error: refused } = await runTurn(eighth, await startThread(eighth, { cwd: workspace }));
  assert.equal(
    refused,
    sourceText("error.provider.opencodeProviderRefused", { provider: "anthropic" }),
    "A provider with a stored key reads as a refused request, not a missing sign-in.",
  );
  report.providerRefused = { error: refused };
  const otherKeySpawn = (await readJsonl<LogEntry>(log)).filter((entry) => entry.event === "spawn").at(-1);
  const otherProviderKey = [otherKeySpawn?.imageTool ?? null, otherKeySpawn?.videoTool ?? null];
  assert.deepEqual(
    otherProviderKey,
    [false, false],
    "A stored key for a provider with no image or video models does not keep the tools (#17402).",
  );
  report.mediaTools = {
    goKeyOnly,
    otherProviderEnvKey,
    textProviderEnvKey,
    customProviderKey,
    textCustomProviderKey,
    userConfigKey,
    otherProviderKey,
  };
  await runCauseEffect(eighth.stop());

  delete process.env.FAKE_PROVIDER_AUTH;
  storedKey = "fresh";
  const inheritedKey = process.env.OPENCODE_API_KEY;
  process.env.OPENCODE_API_KEY = "old-env";
  await rm(log, { force: true });
  try {
    await startThread(open(cli), { cwd: workspace });
  } finally {
    if (inheritedKey === undefined) delete process.env.OPENCODE_API_KEY;
    else process.env.OPENCODE_API_KEY = inheritedKey;
  }
  const inheritedSpawn = (await readJsonl<LogEntry>(log)).find((entry) => entry.event === "spawn");
  assert.equal(inheritedSpawn?.envKey, "", "With a saved key, an inherited OPENCODE_API_KEY is cleared (#15988).");
  assert.equal(inheritedSpawn?.configKey, "fresh", "The saved key stays the OpenCode Go config key.");
  assert.equal(inheritedSpawn?.zenKey, null, "The free tier gets no key (#7550).");
  report.inheritedEnvKey = { envKey: inheritedSpawn?.envKey ?? null, configKey: inheritedSpawn?.configKey ?? null };

  storedKey = "expired-v2";
  const credentials = new DatabaseSync(join(openCodeData, "opencode.db"));
  credentials
    .prepare("INSERT INTO credential (id, integration_id, label, value, active) VALUES (?, ?, ?, ?, ?)")
    .run("cred_2", "opencode-go", "API key", JSON.stringify({ type: "key", key: "old" }), null);
  credentials.close();
  const ninth = open(cli);
  const { error: ownGo } = await runTurn(ninth, await startThread(ninth, { cwd: workspace }));
  assert.equal(
    ownGo,
    sourceText("error.provider.opencodeOwnGoKeyRefused"),
    "A Go key in OpenCode's own store is named as the refused key, not the key saved in OpenBot (#15988).",
  );
  report.ownGoKey = { error: ownGo };
  await runCauseEffect(ninth.stop());

  const sameKey = new DatabaseSync(join(openCodeData, "opencode.db"));
  sameKey
    .prepare("UPDATE credential SET value = ? WHERE id = ?")
    .run(JSON.stringify({ type: "key", key: "expired-v2" }), "cred_2");
  sameKey.close();
  const tenth = open(cli);
  const { error: sameGo } = await runTurn(tenth, await startThread(tenth, { cwd: workspace }));
  assert.equal(
    sameGo,
    sourceText("error.provider.opencodeKeyRefused"),
    "When OpenCode's own Go key is the saved key, the saved key is named as refused.",
  );
  report.sameGoKey = { error: sameGo };
  report.passed = true;
} finally {
  await stopClients(clients);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
