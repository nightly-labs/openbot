// Runs a turn on the real OpenCode driver against a fake `opencode acp` that fails the prompt as
// OpenCode 2.1.3 does: `-32603` "Internal error: Internal service failure" (#2850). Checks that the
// failed turn reads as OpenCode's service failure, with its fix, not the generic text.
// `bun run test:opencode-service-failure`. Writes .openbot-build/opencode-service-failure-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import type { AgentClient } from "../src/backend/agent-client";
import type { AgentCliInfo } from "../src/backend/cli";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { installFakeAgent, runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-service-failure-e2e");

interface Report {
  passed: boolean;
  turn?: { error: string };
}

const root = await mkdtemp(join(tmpdir(), "openbot-opencode-service-failure-e2e-"));
const report: Report = { passed: false };
const clients: AgentClient[] = [];

try {
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const executable = join(root, "opencode", "bin", "opencode");
  await installFakeAgent(executable, "opencode-service-failure");
  const cli: AgentCliInfo = { executable, version: "2.1.3", source: "managed" };
  const client = requireProviderDriver("opencode").createClient(cli, 10_000, NO_PROVIDER_CREDENTIALS);
  clients.push(client);
  client.start();
  const { error } = await runTurn(client, await startThread(client, { cwd: workspace }));
  assert.equal(error, sourceText("error.provider.opencodeServiceFailure"), "A failed turn names OpenCode's service.");
  report.turn = { error };
  report.passed = true;
} finally {
  await stopClients(clients);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
