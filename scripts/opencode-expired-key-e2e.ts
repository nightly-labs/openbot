// Runs turns end to end on the real OpenCode driver against a fake `opencode acp` that picks its key
// as OpenCode 1.18.30 to 1.18.35 do: config `options.apiKey` first, then the `auth.json` key, then
// `OPENCODE_API_KEY`. An old key in `auth.json` used to win over the key pasted into OpenBot (#2544).
// Checks that an expired key reads as the expired-key error, not "Internal error"; that a replaced
// key reaches a new process and the same thread there, although `auth.json` still holds the old
// key; that with no stored key the config names no key, so the user's own sign-in stays in use;
// that a custom endpoint saved as `opencode-go` keeps its URL when a key is stored; and that a model
// whose provider has no sign-in names that provider and its fix (#2746).
// `bun run test:opencode-expired-key`. Writes .openbot-build/opencode-expired-key-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
  sessionId?: string;
  key?: string | null;
}

interface Report {
  passed: boolean;
  expired?: { error: string };
  replaced?: { thread: string; loaded: boolean; key: string | null };
  noStoredKey?: { configKey: string | null; key: string | null };
  endpoint?: { baseURL: string | null; zenKey: string | null };
  authRequired?: { error: string };
}

const root = await mkdtemp(join(tmpdir(), "openbot-opencode-expired-key-e2e-"));
const log = join(root, "opencode.jsonl");
const report: Report = { passed: false };
const clients: AgentClient[] = [];
let storedKey: string | null = "expired";
let endpoints: CustomProviderConfig[] = [];
process.env.FAKE_LOG = log;
// `FAKE_AUTH_KEY` stands for the key in OpenCode's own `auth.json`.
process.env.FAKE_AUTH_KEY = "expired";

/** A new process, as the provider runtime starts after a key change. The key is read at spawn. */
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
  const cli: AgentCliInfo = { executable, version: "1.18.30", source: "managed" };

  // 1. An expired key reads as the expired-key error, with no "Internal error" in front of it.
  const first = open(cli);
  const thread = await startThread(first, { cwd: workspace });
  const { error } = await runTurn(first, thread);
  assert.equal(error, sourceText("error.provider.opencodeKeyExpired"), "An expired key names its own fix.");
  report.expired = { error };

  // 2. A replaced key reaches the next process and the same thread, although `auth.json` still
  // holds the expired key.
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
  report.replaced = { thread, loaded, key: prompt?.key ?? null };
  await runCauseEffect(second.stop());

  // 3. With no stored key the config names no key, so the user's own `auth.json` key stays in use.
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

  // 4. A custom endpoint saved as `opencode-go` replaces that built-in provider, so the stored key
  // must not drop its URL. The `opencode` provider still gets the key.
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
  assert.equal(endpointSpawn.zenKey, "fresh", "The OpenCode provider gets the stored key.");
  report.endpoint = { baseURL: endpointSpawn.baseURL ?? null, zenKey: endpointSpawn.zenKey ?? null };

  // 5. A model whose provider has no sign-in names that provider and how to connect it, not the
  // protocol's bare "Authentication required".
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
  report.passed = true;
} finally {
  await stopClients(clients);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
