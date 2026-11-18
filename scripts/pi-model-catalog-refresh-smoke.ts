// Runs the real `openrouter` provider driver over the real Pi CLI, in a new Pi folder, to check that
// the model list shows OpenRouter's current catalog and not the one that Pi bundled at its release
// (#4926). Pi refreshes the catalog in the background of an RPC process, which OpenBot stopped before
// the refresh ended, so models that OpenRouter added after the Pi release, such as the stealth model
// `stealth/crouton-alpha`, did not show. The driver now runs `pi update --models` first. The check
// runs with Full access, and on macOS also with Workspace only, where Pi must read the saved catalog
// in the sandbox. The key is not valid: OpenRouter's public catalog needs no key.
// `PI_CLI=<path to pi> bun scripts/pi-model-catalog-refresh-smoke.ts`. Needs the network.
// Writes .openbot-build/pi-model-catalog-refresh-smoke/report.json.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AgentClient } from "../src/backend/agent-client";
import { resolvePiCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { providerModelValue } from "../src/backend/encoded-model-id";
import type { ProcessConfinement } from "../src/backend/process-confinement";
import { getArray, getString } from "../src/backend/protocol";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/pi-model-catalog-refresh-smoke");

interface ListCase {
  access: "full" | "workspace";
  listed: number;
  saved: number;
  /** Saved chat models that the list did not show. */
  missing: string[];
  stealth: string[];
  agentFolderAfter: string[];
  errors: string[];
}

interface Report {
  passed: boolean;
  piVersion?: string;
  cases: ListCase[];
  failure?: string;
}

// Not in the temporary folder: the sandbox lets every confined process write there.
await mkdir(OUT, { recursive: true });
const root = await mkdtemp(join(OUT, "run-"));
const agentDirectory = join(root, "pi-agent");
const workspace = join(root, "workspace");
const report: Report = { passed: false, cases: [] };
const clients: AgentClient[] = [];

async function listModels(access: ListCase["access"]): Promise<void> {
  await rm(agentDirectory, { recursive: true, force: true });
  await mkdir(agentDirectory, { recursive: true });
  const cli = await runCauseEffect(resolvePiCli({ bundledExecutable: process.env.PI_CLI }));
  report.piVersion = cli.version;
  const confinement: ProcessConfinement | undefined =
    access === "workspace" ? { writableRoots: [workspace] } : undefined;
  const client = requireProviderDriver("openrouter").createClient(
    cli,
    60_000,
    { apiKey: () => "sk-or-v1-openbot-smoke-not-valid", customProviders: () => [], mcpServers: () => [] },
    confinement,
  );
  clients.push(client);
  const errors: string[] = [];
  client.on("diagnostic", (text: string) => errors.push(text));
  client.start();
  const listed = await runCauseEffect(client.request("model/list", {}, (value) => value));
  const ids = new Set(
    getArray(listed, "data").flatMap((model) => {
      const id = getString(model, "model");
      return id ? [providerModelValue(id)] : [];
    }),
  );
  await stopClients([client]);

  const storePath = join(agentDirectory, "models-store.json");
  assert.ok(existsSync(storePath), "Pi must save the refreshed catalog.");
  const store: { openrouter?: { models?: { id: string; type?: string }[] } } = JSON.parse(
    await readFile(storePath, "utf8"),
  );
  // Pi lists only chat models. The catalog also has image and classifier models.
  const saved = (store.openrouter?.models ?? []).filter((model) => model.type === "chat").map((model) => model.id);
  const result: ListCase = {
    access,
    listed: ids.size,
    saved: saved.length,
    missing: saved.filter((id) => !ids.has(id)),
    stealth: [...ids].filter((id) => id.startsWith("stealth/")),
    agentFolderAfter: (await readdir(agentDirectory)).sort(),
    errors,
  };
  report.cases.push(result);

  assert.ok(saved.length > 0, "The saved catalog has no OpenRouter models.");
  assert.deepEqual(result.missing, [], "The list must show every model of the refreshed catalog.");
  assert.ok(!result.agentFolderAfter.some((name) => name.endsWith(".lock")), "Pi must remove its locks.");
}

try {
  await mkdir(workspace, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDirectory;
  await listModels("full");
  if (process.platform === "darwin") await listModels("workspace");
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
