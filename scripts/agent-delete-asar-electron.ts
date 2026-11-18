// The Electron side of `agent-delete-asar-e2e.ts`. It runs in Electron as Node, where `fs` reads a
// `*.asar` file as a folder. It creates an agent, puts Electron's own `default_app.asar` in the agent
// workspace as a package install does, deletes the agent, and writes the result to the report.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { originalFs } from "../src/backend/original-fs";

function argument(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.find((candidate) => candidate.startsWith(prefix))?.slice(prefix.length);
  if (!value) throw new Error(`Give --${name}.`);
  return value;
}

const reportPath = argument("report-path");
const archivePath = argument("archive-path");
const runId = argument("run-id");
const steps: string[] = [];
const root = await mkdtemp(join(tmpdir(), "openbot-delete-asar-"));

try {
  assert.ok(process.versions.electron, "The driver must run in Electron.");
  const statePath = join(root, "state");
  const homePath = join(root, "home");
  const store = new AgentStore(statePath, homePath, new OpenBotDatabase(statePath));
  await runCauseEffect(store.initialize());
  const agent = await runCauseEffect(
    store.createAgent({ name: "Builder", description: "", avatarSeed: "delete-asar", avatarHue: null }),
  );
  const workspacePath = join(homePath, "OpenBot", "Agents", agent.id);
  assert.ok(originalFs.existsSync(workspacePath), "The new agent has a workspace.");
  const installedArchive = join(workspacePath, "repo/node_modules/electron/dist/resources/default_app.asar");
  await mkdir(dirname(installedArchive), { recursive: true });
  await originalFs.promises.copyFile(archivePath, installedArchive);
  steps.push("The agent workspace holds an `.asar` file");

  await runCauseEffect(store.deleteAgent(agent.id));
  steps.push("The deletion settles");
  assert.equal(originalFs.existsSync(workspacePath), false, "The agent workspace is gone.");
  steps.push("The agent workspace is gone");
  assert.equal(
    store.list().some((candidate) => candidate.id === agent.id),
    false,
    "The agent is not in the roster.",
  );
  steps.push("The agent is not in the roster");
  await writeFile(reportPath, `${JSON.stringify({ status: "passed", runId, steps }, null, 2)}\n`);
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  await writeFile(reportPath, `${JSON.stringify({ status: "failed", runId, steps, reason }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await originalFs.promises.rm(root, { recursive: true, force: true });
}
