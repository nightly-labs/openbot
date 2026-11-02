// Runs the real `deepseek` provider driver over the real Pi CLI with Workspace only access on macOS,
// to check that Pi can read its credential store in the sandbox (#3336). Pi 1.4.0 makes a lock
// folder beside `auth.json` for each read, and writes an empty `auth.json` when there is none. Before
// the fix the sandbox denied both: each turn stopped with "Credential store read failed for deepseek:
// EPERM ... auth.json.lock", and with no `auth.json` Pi exited at the start. The key is not valid, so
// the turn must stop with DeepSeek's answer, not with the sandbox. The last part runs commands in the
// same sandbox to check that only the lock folders became writable.
// `PI_CLI=<path to pi> bun scripts/pi-workspace-only-smoke.ts`. Needs the network.
// Writes .openbot-build/pi-workspace-only-smoke/report.json.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AgentClient } from "../src/backend/agent-client";
import { resolvePiCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { confineSpawnTarget, piStatePaths } from "../src/backend/process-confinement";
import { getArray, getString } from "../src/backend/protocol";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/pi-workspace-only-smoke");
const SANDBOX_FAILURE = /Credential store read failed|EPERM|Operation not permitted|\.lock/u;

interface TurnCase {
  /** The `auth.json` before the start, or null when there is none. */
  authJson: string | null;
  models?: string[];
  status?: string | null;
  errors: string[];
  agentFolderAfter?: string[];
}

interface Probe {
  command: string;
  expected: "allowed" | "denied";
  status: number | null;
}

interface Report {
  passed: boolean;
  piVersion?: string;
  turns: TurnCase[];
  probes?: Probe[];
  failure?: string;
}

// Not in the temporary folder: the sandbox lets every confined process write there.
await mkdir(OUT, { recursive: true });
const root = await mkdtemp(join(OUT, "run-"));
const agentDirectory = join(root, "pi-agent");
const workspace = join(root, "workspace");
const confinement = { writableRoots: [workspace] };
const report: Report = { passed: false, turns: [] };
const clients: AgentClient[] = [];

/**
 * One turn of a fresh client, in a new Pi folder. The folder holds `settings.json`, because Pi takes
 * a lock to read it only when it exists.
 */
async function runPi(turn: TurnCase): Promise<void> {
  report.turns.push(turn);
  await rm(agentDirectory, { recursive: true, force: true });
  await mkdir(agentDirectory, { recursive: true });
  await writeFile(join(agentDirectory, "settings.json"), "{}\n");
  if (turn.authJson !== null) await writeFile(join(agentDirectory, "auth.json"), turn.authJson);
  const cli = await runCauseEffect(resolvePiCli({ bundledExecutable: process.env.PI_CLI }));
  report.piVersion = cli.version;
  const client = requireProviderDriver("deepseek").createClient(
    cli,
    60_000,
    { apiKey: () => "sk-openbot-smoke-not-valid", customProviders: () => [], mcpServers: () => [] },
    confinement,
  );
  clients.push(client);
  client.start();
  client.on("notification", (notification) => {
    if (notification.method === "error") turn.errors.push(JSON.stringify(notification.params));
  });
  client.on("diagnostic", (text: string) => turn.errors.push(text));
  const listed = await runCauseEffect(client.request("model/list", {}, (value) => value));
  turn.models = getArray(listed, "data").flatMap((model) => getString(model, "model") ?? []);
  const model = turn.models[0];
  assert.ok(model, "The deepseek row lists no models.");
  const thread = await startThread(client, { cwd: workspace, model });
  const result = await runTurn(client, thread, { text: "Say OK.", timeoutMs: 120_000 });
  turn.status = result.status;
  await stopClients([client]);
  turn.agentFolderAfter = (await readdir(agentDirectory)).sort();

  assert.ok(result.error, "A key that is not valid must stop the turn.");
  for (const error of turn.errors) assert.doesNotMatch(error, SANDBOX_FAILURE);
  assert.ok(
    turn.errors.some((error) => error.includes("DeepSeek refused")),
    "The turn must reach DeepSeek.",
  );
  assert.equal(await readFile(join(agentDirectory, "auth.json"), "utf8"), turn.authJson ?? "{}");
  assert.equal(await readFile(join(agentDirectory, "settings.json"), "utf8"), "{}\n");
  assert.ok(!turn.agentFolderAfter.some((name) => name.endsWith(".lock")), "Pi must remove its locks.");
}

try {
  if (process.platform !== "darwin") throw new Error("Workspace only runs only on macOS.");
  await mkdir(workspace, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDirectory;
  // As in the issue: Pi ran with Full access before, so `auth.json` exists and is empty.
  await runPi({ authJson: "{}", errors: [] });
  // A user who never ran Pi with Full access has no `auth.json`. OpenBot makes it before the start.
  await runPi({ authJson: null, errors: [] });

  // The same sandbox, with commands in place of Pi.
  const state = piStatePaths({ PI_CODING_AGENT_DIR: agentDirectory });
  const lock = join(agentDirectory, "auth.json.lock");
  const checks: [string[], Probe["expected"]][] = [
    [["/bin/mkdir", lock], "allowed"],
    [[process.execPath, "-e", "require('fs').utimesSync(process.argv[1], new Date(), new Date())", lock], "allowed"],
    [["/bin/mkdir", join(lock, "inside")], "denied"],
    [["/usr/bin/touch", join(lock, "file")], "denied"],
    [["/bin/rmdir", lock], "allowed"],
    [["/bin/ln", "-s", root, lock], "denied"],
    [["/usr/bin/touch", lock], "denied"],
    [["/bin/sh", "-c", `printf x > ${JSON.stringify(join(agentDirectory, "auth.json"))}`], "denied"],
    [["/bin/sh", "-c", `printf x > ${JSON.stringify(join(agentDirectory, "settings.json"))}`], "denied"],
    [["/bin/mkdir", join(agentDirectory, "models.json.lock")], "denied"],
    [["/bin/mkdir", join(agentDirectory, "settings.json.lock")], "allowed"],
    [["/bin/mkdir", join(agentDirectory, "trust.json.lock")], "allowed"],
  ];
  report.probes = checks.map(([[command = "", ...args], expected]) => {
    const target = confineSpawnTarget({ command, args, windowsVerbatimArguments: false }, confinement, state);
    const { status } = spawnSync(target.command, target.args, { stdio: "ignore" });
    return { command: [command, ...args].join(" "), expected, status };
  });
  for (const probe of report.probes)
    assert.equal(probe.status === 0, probe.expected === "allowed", `${probe.expected}: ${probe.command}`);
  assert.equal(await readFile(join(agentDirectory, "auth.json"), "utf8"), "{}");
  assert.ok(!existsSync(join(agentDirectory, "models.json.lock")));

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
