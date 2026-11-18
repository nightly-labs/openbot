// Runs turns end to end on the real OpenCode driver against a fake `opencode acp` that picks its key
// as OpenCode 1.18.30 to 1.18.35 do: config `options.apiKey` first, then the `auth.json` key, then
// `OPENCODE_API_KEY`. An old key in `auth.json` used to win over the key pasted into OpenBot (#2544).
// Checks that an expired key reads as the expired-key error, not "Internal error"; that a replaced
// key reaches a new process and the same thread there, although `auth.json` still holds the old
// key; that with no stored key the config names no key, so the user's own sign-in stays in use;
// that a custom endpoint saved as `opencode-go` keeps its URL when a key is stored; that the stored
// key reaches neither the free tier nor `OPENCODE_API_KEY`, so a refused key cannot fail the free
// models (#7550); that a model whose provider has no sign-in names that provider and its fix
// (#2746); that OpenCode 2's `-32000` for a refused saved key names the saved key, not a missing
// sign-in (#9095); and that a `-32000` for a provider with a key in OpenCode 2's own database says
// that the provider refused the request, as a firewall's 403 does, not that a sign-in is missing (#10166).
// `bun run test:opencode-expired-key`. Writes .openbot-build/opencode-expired-key-e2e/report.json.
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
  refusedV2?: { saved: string; notSaved: string };
  providerRefused?: { error: string };
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
// OpenBot reads OpenCode's own key store here, never the developer's.
const openCodeData = join(root, "data", "opencode");
process.env.XDG_DATA_HOME = join(root, "data");
delete process.env.OPENCODE_AUTH_CONTENT;
delete process.env.OPENCODE_DB;

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
  const keySpawn = entries.filter((entry) => entry.event === "spawn").at(-1);
  assert.equal(keySpawn?.zenKey, null, "The free tier gets no stored key (#7550).");
  assert.equal(keySpawn?.envKey, null, "OPENCODE_API_KEY does not carry the stored key (#7550).");
  report.replaced = {
    thread,
    loaded,
    key: prompt?.key ?? null,
    zenKey: keySpawn?.zenKey ?? null,
    envKey: keySpawn?.envKey ?? null,
  };
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
  // must not drop its URL. The free `opencode` provider gets no key.
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

  // 6. OpenCode 2.2.5 sends a refused OpenCode Go key as `-32000` with no reason. With a saved key the
  // error names that key and its fix. With no saved key OpenBot cannot tell a refused key from a
  // missing one, so the error stays the missing sign-in.
  delete process.env.FAKE_PROVIDER_AUTH;
  storedKey = "expired-v2";
  const sixth = open(cli);
  const { error: saved } = await runTurn(sixth, await startThread(sixth, { cwd: workspace }));
  assert.equal(saved, sourceText("error.provider.opencodeKeyRefused"), "A refused saved key names its fix.");
  await runCauseEffect(sixth.stop());
  storedKey = null;
  process.env.FAKE_AUTH_KEY = "expired-v2";
  // The Go key in OpenCode's own `auth.json` keeps the Go text, which names OpenBot's settings (#10166).
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
  report.refusedV2 = { saved, notSaved };
  await runCauseEffect(seventh.stop());

  // 8. OpenCode 2.3.0 sends each 403 of a provider as `-32000`, also a firewall's block of a VPN
  // address. With a key for that provider in OpenCode's own database, the provider refused the
  // request: the error must not say that a sign-in is missing.
  const database = new DatabaseSync(join(openCodeData, "opencode.db"));
  database.exec(
    "CREATE TABLE credential (id TEXT PRIMARY KEY, integration_id TEXT, label TEXT NOT NULL, value TEXT NOT NULL, active INTEGER)",
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
  report.passed = true;
} finally {
  await stopClients(clients);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
