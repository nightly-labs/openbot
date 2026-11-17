// Runs the real `openrouter` provider driver, which is the Pi client, and the real model catalog over a
// fake Pi (`provider-fakes/agents/pi-slow-start.ts`) that starts slowly (#9945). Each account check and
// each model list of a key-only Pi provider starts a new `pi` process. The account check at start had
// the 5 s of a check of a running CLI, and the model list kept a 5 s timeout as the provider's last
// error. On a slow Windows computer, the OpenRouter row then showed "Error" with "Pi request timed
// out: get_state" while its key worked. The check runs:
// - the account check with a short check timeout on a Pi that answers after that timeout;
// - the model catalog on a Pi that answers after its 5 s pass, then the full read again;
// - the model catalog on a Pi that never answers: the error must still show.
// `bun run test:pi-slow-start`. Writes .openbot-build/pi-slow-start-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { ModelCatalog } from "../src/backend/agent/model-catalog";
import type { AgentClient, AgentProvider } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { getRecord, getString } from "../src/backend/protocol";
import { requireProviderDriver } from "../src/backend/provider-drivers";
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
