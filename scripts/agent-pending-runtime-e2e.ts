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
import { pendingRuntimeAfterUpdate } from "../src/backend/agent/pending-runtime";
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

  const accountId = "a0000000000000001";
  const sweptModel = "pending-model-swept";

  await step("An account switch queues while the agent works", async () => {
    const updated = await runCauseEffect(
      store.updateAgent({
        agentId: agent.id,
        pendingRuntime: {
          provider: pendingProvider,
          model: "pending-model",
          reasoningEffort: "high",
          providerAccountId: accountId,
        },
      }),
    );
    assert.equal(updated.providerAccountId, undefined);
    assert.equal(updated.pendingRuntime?.providerAccountId, accountId);
    return updated.pendingRuntime;
  });

  await step("A model sweep that names no account keeps the account switch", async () => {
    const before = store.get(agent.id);
    assert.ok(before);
    const pendingRuntime = pendingRuntimeAfterUpdate({
      update: {},
      previous: before,
      next: { provider: before.provider, model: sweptModel, reasoningEffort: before.reasoningEffort },
      runtime: true,
      queueWhileBusy: true,
      handover: false,
    });
    assert.ok(pendingRuntime);
    const swept = await runCauseEffect(
      store.updateAgent({
        agentId: agent.id,
        provider: before.provider,
        model: sweptModel,
        reasoningEffort: before.reasoningEffort,
        pendingRuntime,
      }),
    );
    assert.equal(swept.model, sweptModel);
    assert.equal(swept.providerAccountId, undefined);
    assert.deepEqual(swept.pendingRuntime, {
      provider: before.provider,
      model: sweptModel,
      reasoningEffort: before.reasoningEffort,
      providerAccountId: accountId,
    });
    return swept.pendingRuntime;
  });

  await step("The account switch applies before the next turn", async () => {
    const queued = store.get(agent.id)?.pendingRuntime;
    assert.ok(queued);
    const applied = await runCauseEffect(
      store.updateAgent({
        agentId: agent.id,
        provider: queued.provider,
        model: queued.model,
        reasoningEffort: queued.reasoningEffort,
        providerAccountId: queued.providerAccountId ?? null,
      }),
    );
    assert.equal(applied.providerAccountId, accountId);
    assert.equal(applied.pendingRuntime, undefined);
    return { providerAccountId: applied.providerAccountId ?? null, model: applied.model };
  });

  await step("An account change that is not the queued one leaves the switch queued", async () => {
    const second = "a0000000000000002";
    const third = "a0000000000000003";
    await runCauseEffect(
      store.updateAgent({
        agentId: agent.id,
        pendingRuntime: {
          provider: pendingProvider,
          model: sweptModel,
          reasoningEffort: "high",
          providerAccountId: second,
        },
      }),
    );
    const moved = await runCauseEffect(store.updateAgent({ agentId: agent.id, providerAccountId: third }));
    assert.equal(moved.providerAccountId, third);
    assert.equal(moved.pendingRuntime?.providerAccountId, second);
    return { providerAccountId: moved.providerAccountId ?? null, pendingRuntime: moved.pendingRuntime ?? null };
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
