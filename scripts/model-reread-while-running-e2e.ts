import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import { ModelCatalog } from "../src/backend/agent/model-catalog";
import type { AgentClient, AgentProvider } from "../src/backend/agent-client";
import { resolveOpencodeCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { installFakeAgent, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/model-reread-while-running-e2e");
const PI_BEFORE = "fake/first-model";
const PI_ADDED = "fake/added-model";
const OPENCODE_ENDPOINT = "local";
const OPENCODE_BEFORE = "first-model";
const OPENCODE_ADDED = "added-model";
const REREAD_DEADLINE_MS = 30_000;

interface ProviderCase {
  relistWhileRunning: boolean;
  version?: string;
  atStart?: string[];
  afterReread?: string[];
  rereads?: number;
  providerErrors?: number;
}

interface Report {
  passed: boolean;
  pi?: ProviderCase;
  opencode?: ProviderCase;
  failure?: string;
}

const root = await mkdtemp(join(tmpdir(), "openbot-model-reread-e2e-"));
const report: Report = { passed: false };
const clients: AgentClient[] = [];
const run = promisify(execFile);
let openCodeCli: string | null = null;

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((listening) => probe.listen(0, "127.0.0.1", listening));
  const address = probe.address();
  await new Promise<void>((closed) => probe.close(() => closed()));
  if (!address || typeof address === "string") throw new Error("The port probe has no port.");
  return address.port;
}

function catalogFor(provider: AgentProvider, client: AgentClient, errors: unknown[]): ModelCatalog {
  return new ModelCatalog({
    client: (candidate) => (candidate === provider ? client : undefined),
    isSignedOut: () => false,
    requestTimeoutMs: 60_000,
    recordProviderError: (_provider, error) => errors.push(error),
    startSettingsChanged: () => Effect.void,
  });
}

function listed(catalog: ModelCatalog, provider: AgentProvider): string[] {
  return catalog
    .list()
    .filter((model) => model.provider === provider)
    .map((model) => model.id);
}

async function rereadUntil(catalog: ModelCatalog, provider: AgentProvider, shows: (ids: string[]) => boolean) {
  const deadline = Date.now() + REREAD_DEADLINE_MS;
  let rereads = 0;
  while (Date.now() < deadline) {
    rereads += 1;
    await runCauseEffect(catalog.relist(provider, { quiet: true }));
    if (shows(listed(catalog, provider))) return rereads;
  }
  throw new Error(`${provider} did not list the added model before the deadline.`);
}

async function checkPi(): Promise<void> {
  const result: ProviderCase = {
    relistWhileRunning: requireProviderDriver("pi").catalog?.relistWhileRunning === true,
  };
  report.pi = result;
  assert.ok(result.relistWhileRunning, "The Pi list is read again while Pi runs.");
  const executable = join(root, "pi", "bin", "pi");
  const modelFile = join(root, "pi-model.txt");
  process.env.PI_CODING_AGENT_DIR = join(root, "pi-agent");
  await mkdir(process.env.PI_CODING_AGENT_DIR, { recursive: true });
  await writeFile(modelFile, PI_BEFORE);
  await installFakeAgent(executable, "pi-slow-start", { FAKE_MODEL_FILE: modelFile });
  const client = requireProviderDriver("pi").createClient(
    { executable, version: "1.5.2", source: "managed" },
    60_000,
    NO_PROVIDER_CREDENTIALS,
  );
  clients.push(client);
  client.start();
  const errors: unknown[] = [];
  const catalog = catalogFor("pi", client, errors);
  await runCauseEffect(catalog.refresh());
  result.atStart = listed(catalog, "pi");
  assert.ok(
    result.atStart.some((id) => id.endsWith(PI_BEFORE)),
    "The start lists the model in models.json.",
  );
  await writeFile(modelFile, PI_ADDED);
  result.rereads = await rereadUntil(catalog, "pi", (ids) => ids.some((id) => id.endsWith(PI_ADDED)));
  result.afterReread = listed(catalog, "pi");
  result.providerErrors = errors.length;
  assert.equal(result.providerErrors, 0, "No Pi read records a provider error.");
}

async function writeOpenCodeConfig(models: readonly string[]): Promise<void> {
  await writeFile(
    join(root, "config", "opencode", "opencode.json"),
    `${JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        model: `${OPENCODE_ENDPOINT}/${OPENCODE_BEFORE}`,
        provider: {
          [OPENCODE_ENDPOINT]: {
            npm: "@ai-sdk/openai-compatible",
            name: "Local",
            options: { baseURL: "http://127.0.0.1:9/v1", apiKey: "e2e-not-a-key" },
            models: Object.fromEntries(models.map((id) => [id, { name: id }])),
          },
        },
      },
      null,
      2,
    )}\n`,
  );
}

async function checkOpenCode(): Promise<void> {
  const result: ProviderCase = {
    relistWhileRunning: requireProviderDriver("opencode").catalog?.relistWhileRunning === true,
  };
  report.opencode = result;
  assert.ok(result.relistWhileRunning, "The OpenCode list is read again while OpenCode runs.");
  for (const [name, folder] of [
    ["HOME", "home"],
    ["XDG_CONFIG_HOME", "config"],
    ["XDG_DATA_HOME", "data"],
    ["XDG_STATE_HOME", "state"],
    ["XDG_CACHE_HOME", "cache"],
  ] as const) {
    process.env[name] = join(root, folder);
    await mkdir(join(root, folder), { recursive: true });
  }
  await mkdir(join(root, "config", "opencode"), { recursive: true });
  await writeOpenCodeConfig([OPENCODE_BEFORE]);
  const cli = await runCauseEffect(resolveOpencodeCli({ bundledExecutable: process.env.OPENCODE_CLI }));
  result.version = cli.version;
  openCodeCli = cli.executable;
  await run(cli.executable, ["service", "set", "port", String(await freePort())], { env: process.env });
  const client = requireProviderDriver("opencode").createClient(cli, 60_000, {
    ...NO_PROVIDER_CREDENTIALS,
    providerStateDirectory: join(root, "provider-state"),
  });
  clients.push(client);
  client.start();
  const errors: unknown[] = [];
  const catalog = catalogFor("opencode", client, errors);
  await runCauseEffect(catalog.refresh());
  result.atStart = listed(catalog, "opencode");
  assert.ok(
    result.atStart.includes(`${OPENCODE_ENDPOINT}/${OPENCODE_BEFORE}`),
    "The start lists the model in opencode.json.",
  );
  await writeOpenCodeConfig([OPENCODE_BEFORE, OPENCODE_ADDED]);
  result.rereads = await rereadUntil(catalog, "opencode", (ids) =>
    ids.includes(`${OPENCODE_ENDPOINT}/${OPENCODE_ADDED}`),
  );
  result.afterReread = listed(catalog, "opencode");
  result.providerErrors = errors.length;
  assert.equal(result.providerErrors, 0, "No OpenCode read records a provider error.");
}

try {
  await checkPi();
  await checkOpenCode();
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await stopClients(clients).catch(() => undefined);
  if (openCodeCli) await run(openCodeCli, ["service", "stop"], { env: process.env }).catch(() => undefined);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}
