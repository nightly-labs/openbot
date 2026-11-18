// Runs the real `openrouter` provider driver, which is the Pi client, and the real model catalog over a
// fake Pi (`provider-fakes/agents/pi-slow-start.ts`) that starts slowly (#9945). Each account check and
// each model list of a key-only Pi provider starts a new `pi` process. The account check at start had
// the 5 s of a check of a running CLI, and the model list kept a 5 s timeout as the provider's last
// error. On a slow Windows computer, the OpenRouter row then showed "Error" with "Pi request timed
// out: get_state" while its key worked. The check runs:
// - the account check with a short check timeout on a Pi that answers after that timeout;
// - the model catalog on a Pi that answers after its 5 s pass, then the full read again;
// - the model catalog on a Pi that never answers: the error must still show;
// - the provider runtime, with a second 5 s pass that times out while the full read of the first runs.
//   The full read lists the models, so the row must not keep "Error" (#12166).
// `bun run test:pi-slow-start`. Writes .openbot-build/pi-slow-start-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { ModelCatalog } from "../src/backend/agent/model-catalog";
import { ProviderRuntime } from "../src/backend/agent/provider-runtime";
import type { AgentClient, AgentProvider } from "../src/backend/agent-client";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { getRecord, getString } from "../src/backend/protocol";
import {
  BUILT_IN_PROVIDER_DRIVERS,
  NO_PROVIDER_CREDENTIALS,
  requireProviderDriver,
} from "../src/backend/provider-drivers";
import { installFakeAgent, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/pi-slow-start-e2e");

interface CatalogCase {
  timedOut: boolean;
  recordedAfterPass: string[];
  relisted: boolean;
  recordedAfterRelist: string[];
  models: string[];
}

interface Report {
  passed: boolean;
  account?: { email: string | null; type: string | null } | null;
  slowCatalog?: CatalogCase;
  brokenCatalog?: CatalogCase;
  overlap?: { errorAfterSecondPass: string | null; errorAfterFullRead: string | null; models: string[] };
  failure?: string;
}

const root = await mkdtemp(join(tmpdir(), "openbot-pi-slow-start-e2e-"));
const report: Report = { passed: false };
const clients: AgentClient[] = [];

async function openRouterClient(name: string, env: Record<string, string>, requestTimeoutMs: number) {
  const executable = join(root, name, "pi");
  await installFakeAgent(executable, "pi-slow-start", env);
  const client = requireProviderDriver("openrouter").createClient(
    { executable, version: "1.5.2", source: "managed" },
    requestTimeoutMs,
    { apiKey: () => "sk-or-v1-openbot-e2e-not-valid", customProviders: () => [], mcpServers: () => [] },
  );
  clients.push(client);
  client.start();
  return client;
}

/** The 5 s pass of the catalog, then the full read again that the provider runtime starts. */
async function readCatalog(client: AgentClient, requestTimeoutMs: number): Promise<CatalogCase> {
  const recorded: string[] = [];
  const catalog = new ModelCatalog({
    client: (provider: AgentProvider) => (provider === "openrouter" ? client : undefined),
    isSignedOut: () => false,
    requestTimeoutMs,
    recordProviderError: (_provider, error) => recorded.push(error instanceof Error ? error.message : String(error)),
    startSettingsChanged: () => Effect.void,
  });
  const pass = await runCauseEffect(catalog.refresh());
  const recordedAfterPass = [...recorded];
  const relisted = await runCauseEffect(catalog.relist("openrouter"));
  return {
    timedOut: pass.timedOut.has("openrouter"),
    recordedAfterPass,
    relisted,
    recordedAfterRelist: [...recorded],
    models: catalog
      .list()
      .filter((model) => model.provider === "openrouter")
      .map((model) => model.id),
  };
}

/**
 * The Pi row of the real provider runtime over a Pi that needs `delayMs` for each start. A pass gives
 * 5 s, so it times out and starts the full read. A second pass then times out while that read runs.
 */
async function readOverlappingPasses(delayMs: number, requestTimeoutMs: number): Promise<Report["overlap"]> {
  const pi = join(root, "runtime", "pi");
  await installFakeAgent(pi, "pi-slow-start", { FAKE_START_DELAY_MS: String(delayMs) });
  const piDirectory = join(root, "runtime", "pi-agent");
  await mkdir(piDirectory, { recursive: true });
  await writeFile(join(piDirectory, "auth.json"), JSON.stringify({ openrouter: { type: "api_key", key: "fake" } }));
  const names = ["OPENBOT_PI_PATH", "PI_CODING_AGENT_DIR"] as const;
  const saved = names.map((name) => [name, process.env[name]] as const);
  process.env.OPENBOT_PI_PATH = pi;
  process.env.PI_CODING_AGENT_DIR = piDirectory;
  const listeners = new Set<() => void>();
  const profile = join(root, "runtime", "profile");
  const store = new AgentStore(profile, join(root, "runtime", "home"), new OpenBotDatabase(profile));
  const providers = new ProviderRuntime({
    offProviders: BUILT_IN_PROVIDER_DRIVERS.map((driver) => driver.id).filter((id) => id !== "pi"),
    conversation: new ConversationRuntime(
      store,
      () => undefined,
      () => store.list(),
    ),
    hooks: {
      bindClient: () => undefined,
      onProvidersReady: () => Effect.void,
      onProviderLost: () => undefined,
      onClientStopped: () => Effect.void,
      isStopping: () => false,
      isProviderBusy: () => false,
      isAgentBusy: () => false,
      isProviderAssigned: () => true,
      onAgentClientLost: () => Effect.void,
      sharedRoot: () => join(root, "runtime", "shared"),
      onProviderResumed: () => undefined,
      onProviderActivated: () => Effect.void,
      captureConfigRevision: () => 0,
    },
    emit: () => {
      for (const listener of listeners) listener();
    },
    emitError: () => undefined,
    requestTimeoutMs,
    preferredProvider: "pi",
    bundledExecutables: {},
    credentials: NO_PROVIDER_CREDENTIALS,
    redactMcp: (text) => text,
    clientFactory: (provider, cli) =>
      requireProviderDriver(provider).createClient(cli, requestTimeoutMs, NO_PROVIDER_CREDENTIALS),
  });
  const lastError = () => providers.status().providers?.find((row) => row.id === "pi")?.lastError ?? null;
  const models = () =>
    providers
      .listModels()
      .filter((model) => model.provider === "pi")
      .map((model) => model.id);
  /** Resolves at the first status event, or now, at which `ready` holds. Fails after `requestTimeoutMs`. */
  const waitFor = (ready: () => boolean, what: string) =>
    new Promise<void>((resolve, reject) => {
      const check = () => {
        if (!ready()) return;
        clearTimeout(timer);
        listeners.delete(check);
        resolve();
      };
      const timer = setTimeout(() => {
        listeners.delete(check);
        reject(new Error(`Timed out waiting for ${what}.`));
      }, requestTimeoutMs);
      listeners.add(check);
      check();
    });
  try {
    await runCauseEffect(providers.start());
    // The start's own pass also times out; its full read lists the models.
    await waitFor(() => models().length > 0 && lastError() === null, "the models after the start");
    // The first pass times out and starts the full read. The second pass times out while that read runs.
    await runCauseEffect(providers.refreshModels());
    await runCauseEffect(providers.refreshModels());
    const errorAfterSecondPass = lastError();
    await waitFor(() => lastError() === null, "the full read to clear the timeout").catch(() => undefined);
    return { errorAfterSecondPass, errorAfterFullRead: lastError(), models: models() };
  } finally {
    for (const client of await runCauseEffect(providers.dispose())) await runCauseEffect(client.stop());
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

try {
  await mkdir(OUT, { recursive: true });

  // The start check of the provider runtime gives 5 s. Here 500 ms, on a Pi that answers after 1.5 s.
  const accountClient = await openRouterClient("account", { FAKE_START_DELAY_MS: "1500" }, 10_000);
  const account = await runCauseEffect(
    accountClient.request("account/read", { refreshToken: false }, (value) => value, 500),
  );
  const read = getRecord(account, "account");
  report.account = read ? { email: getString(read, "email"), type: getString(read, "type") } : null;
  assert.equal(report.account?.type, "openrouter", "The account check must wait for a slow Pi start.");

  // The 5 s pass times out. Its timeout is no error: the full read lists the model.
  const slow = await openRouterClient("slow", { FAKE_START_DELAY_MS: "6500" }, 15_000);
  report.slowCatalog = await readCatalog(slow, 15_000);
  assert.equal(report.slowCatalog.timedOut, true, "The 5 s pass must time out on this Pi.");
  assert.deepEqual(report.slowCatalog.recordedAfterPass, [], "A timeout that a full read repairs is no error.");
  assert.equal(report.slowCatalog.relisted, true, "The full read must list the models.");
  assert.deepEqual(report.slowCatalog.recordedAfterRelist, []);
  assert.deepEqual(report.slowCatalog.models, ["fake/slow-start"], "The catalog must have the model of the slow Pi.");

  // A Pi that never answers still shows its error, from the full read.
  const broken = await openRouterClient("broken", { FAKE_HANG: "1" }, 6_000);
  report.brokenCatalog = await readCatalog(broken, 6_000);
  assert.equal(report.brokenCatalog.timedOut, true);
  assert.deepEqual(report.brokenCatalog.recordedAfterPass, []);
  assert.equal(report.brokenCatalog.relisted, false);
  assert.equal(report.brokenCatalog.recordedAfterRelist.length, 1, "A list that fails again must show its error.");
  assert.match(report.brokenCatalog.recordedAfterRelist[0] ?? "", /timed out/u);

  // 8 s per Pi start: each pass times out at 5 s, and the full read of the first pass ends after the
  // second pass timed out.
  report.overlap = await readOverlappingPasses(8_000, 20_000);
  assert.match(report.overlap?.errorAfterSecondPass ?? "", /timed out/u, "The second pass must time out.");
  assert.equal(report.overlap?.errorAfterFullRead, null, "The full read that listed the models must clear it.");
  assert.deepEqual(report.overlap?.models, ["openrouter/fake/slow-start"]);

  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await stopClients(clients);
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
