// A fake Cursor parameterized catalog has no `thought_level`. DeepSeek's `reasoning` select, with
// four levels, appears only after that model is selected. Checks that `model/list` reports those
// four levels as configurable, and that a turn on high sets the `reasoning` option to high.
// `bun run test:cursor-reasoning-effort`. Writes .openbot-build/cursor-reasoning-effort-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { AgentClient } from "../src/backend/agent-client";
import type { AgentCliInfo } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { decodeModelListResponse, type ModelListResponse } from "../src/backend/protocol";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { installFakeAgent, readJsonl, runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/cursor-reasoning-effort-e2e");
const DEEPSEEK = "deepseek-v4[fast=false]";
const EFFORTS = ["none", "low", "medium", "high", "max"];

/** A Windows spawn cannot run the shell script `installFakeAgent` writes, so the fake is a `.cmd`. */
async function installCursorFake(executable: string, log: string): Promise<string> {
  if (process.platform !== "win32") {
    await installFakeAgent(executable, "cursor-reasoning-effort", { FAKE_LOG: log });
    return executable;
  }
  const cmd = `${executable}.cmd`;
  const file = resolve(import.meta.dirname, "provider-fakes/agents/cursor-reasoning-effort.ts");
  await mkdir(dirname(cmd), { recursive: true });
  await writeFile(cmd, `@echo off\r\nset "FAKE_LOG=${log}"\r\n"${process.execPath}" "${file}" %*\r\n`);
  return cmd;
}

interface SetEntry {
  method: string;
  configId: string;
  value: string;
}

interface Report {
  passed: boolean;
  deepseekEfforts: string[];
  composerEfforts: string[];
  reasoningSets: SetEntry[];
}

const root = await mkdtemp(join(tmpdir(), "openbot-cursor-reasoning-effort-e2e-"));
const report: Report = { passed: false, deepseekEfforts: [], composerEfforts: [], reasoningSets: [] };
const clients: AgentClient[] = [];

try {
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const log = join(root, "sets.jsonl");
  const executable = await installCursorFake(join(root, "cursor", "cursor-agent"), log);
  const cli: AgentCliInfo = { executable, version: "2026.10.22-27dcf5f", source: "managed" };
  const client = requireProviderDriver("cursor").createClient(cli, 15_000, NO_PROVIDER_CREDENTIALS);
  clients.push(client);
  client.start();

  const listed = await runCauseEffect(client.request("model/list", {}, decodeModelListResponse, 15_000));
  const efforts = (id: string) =>
    listed.data
      .find((model) => model.model === id)
      ?.supportedReasoningEfforts?.flatMap((effort) => (effort.reasoningEffort ? [effort.reasoningEffort] : [])) ?? [];
  const row = (id: string): ModelListResponse["data"][number] | undefined =>
    listed.data.find((model) => model.model === id);
  report.deepseekEfforts = efforts(DEEPSEEK);
  report.composerEfforts = efforts("composer-2.5[fast=false]");
  assert.deepEqual(report.deepseekEfforts, EFFORTS, "DeepSeek lists the four reasoning levels.");
  assert.notEqual(row(DEEPSEEK)?.reasoningEffortConfigurable, false, "DeepSeek's effort is configurable.");
  assert.deepEqual(report.composerEfforts, ["medium"], "Composer lists a different reasoning set.");

  const thread = await startThread(client, { cwd: workspace, model: DEEPSEEK });
  const seen = (await readJsonl<SetEntry>(log)).length;
  const turn = await runTurn(client, thread, { model: DEEPSEEK, effort: "high", text: "ping" });
  report.reasoningSets = (await readJsonl<SetEntry>(log)).slice(seen).filter((entry) => entry.configId === "reasoning");
  assert.deepEqual(report.reasoningSets, [
    { method: "session/set_config_option", configId: "reasoning", value: "high" },
  ]);
  assert.equal(turn.status, "completed", "The turn completes.");
  assert.equal(turn.reply, "Model: deepseek-v4 Reasoning: high", "The turn runs at high.");
  report.passed = true;
} finally {
  await stopClients(clients);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
