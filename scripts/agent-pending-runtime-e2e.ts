// Checks that a queued provider change survives a store reload, and that a handover that lands
// clears it. No provider, account or network is started.
// Run: `bun scripts/agent-pending-runtime-e2e.ts`.
// Writes .openbot-build/agent-pending-runtime-e2e/report.json.

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentProviderId } from "@openbot/contracts/ipc";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "agent-pending-runtime-e2e");

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: { passed: boolean; steps: Step[] } = { passed: false, steps: [] };

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  process.stdout.write(`- ${name}\n`);
  try {
    const value = await run();
    report.steps.push({ name, passed: true, detail: value });
    return value;
  } catch (error) {
    report.steps.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

const root = await mkdtemp(join(tmpdir(), "openbot-pending-runtime-"));
const statePath = join(root, "state");
const homePath = join(root, "home");
const database = new OpenBotDatabase(statePath);
const store = new AgentStore(statePath, homePath, database);

try {
  await runCauseEffect(store.initialize());
  const agent = await runCauseEffect(
    store.createAgent({ name: "Writer", description: "", avatarSeed: "pending-a", avatarHue: null }),
  );
  const pendingProvider: AgentProviderId = agent.provider === "codex" ? "claude" : "codex";
  const pending = {
    provider: pendingProvider,
    model: "pending-model",
    reasoningEffort: "high" as const,
  };

  await step("A queued runtime is stored on the agent", async () => {
    const updated = await runCauseEffect(store.updateAgent({ agentId: agent.id, pendingRuntime: pending }));
    assert.equal(updated.provider, agent.provider);
    assert.equal(updated.model, agent.model);
    assert.deepEqual(updated.pendingRuntime, pending);
    return updated.pendingRuntime;
  });

  await step("The queued runtime survives a reload", async () => {
    const reopened = new AgentStore(statePath, homePath, new OpenBotDatabase(statePath));
    await runCauseEffect(reopened.initialize());
    const loaded = reopened.list().find((candidate) => candidate.id === agent.id);
    assert.ok(loaded);
    assert.deepEqual(loaded.pendingRuntime, pending);
    return loaded.pendingRuntime;
  });

  await step("A provider handover that lands clears the queued runtime", async () => {
    const moved = await runCauseEffect(
      store.updateAgent({
        agentId: agent.id,
        provider: pendingProvider,
        model: "pending-model",
        reasoningEffort: "high",
      }),
    );
    assert.equal(moved.provider, pendingProvider);
    assert.equal(moved.pendingRuntime, undefined);
    return { provider: moved.provider, pendingRuntime: moved.pendingRuntime ?? null };
  });

  report.passed = true;
} catch (error) {
  if (report.steps.every((entry) => entry.passed)) {
    report.steps.push({
      name: "run",
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

if (!report.passed) {
  process.exitCode = 1;
}
