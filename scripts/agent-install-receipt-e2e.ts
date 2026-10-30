// Run: bun scripts/agent-install-receipt-e2e.ts
// Report: .openbot-build/agent-install-receipt-e2e.json
// Drives the real agent marketplace service with injected auth, agent and skill boundaries.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentSummary,
  InstallMarketplaceAgentInput,
  InstallMarketplaceAgentResult,
  MarketplaceAgentDetail,
} from "@openbot/contracts/ipc";
import { Effect, Exit, Schema } from "effect";
import { type AgentMarketplaceFailure, AgentMarketplaceService } from "../src/main/agent-marketplace-service";
import { CentralAuthOperationError } from "../src/main/central-auth-effects";
import { CentralAuthManager } from "../src/main/central-auth-manager";
import { SkillMarketplaceFailure } from "../src/main/skill-marketplace-service";

type AgentMarketplaceDependencies = ConstructorParameters<typeof AgentMarketplaceService>;
type AgentStore = AgentMarketplaceDependencies[1];
type SkillStore = AgentMarketplaceDependencies[2];
type RoutineInput = Parameters<AgentStore["createRoutine"]>[0];

interface ScenarioOptions {
  receiptDefect?: boolean;
  receiptInterrupt?: boolean;
  receiptFailure?: boolean;
  skillFailure?: boolean;
  /** Start from a saved copy of an older version, so the install is an update. */
  update?: boolean;
  receiptAttempts?: number;
}

interface ScenarioState {
  service: AgentMarketplaceService;
  result: Exit.Exit<InstallMarketplaceAgentResult, AgentMarketplaceFailure>;
  agents: Map<string, AgentSummary>;
  routines: Map<string, RoutineInput>;
  skillInstalls: string[];
  receipts: string[];
}

interface CaseReport {
  name: string;
  status: "pass" | "fail";
  receiptAttempts: number;
  receipts: number;
  agents: number;
  routines: number;
  reason?: string;
}

const decodeReceipt = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ receiptId: Schema.String })));

// Do not copy messages, stacks, causes or assertion values into diagnostics.
function failureReason(error: unknown, phase: string): string {
  if (error instanceof assert.AssertionError) return `Assertion failed during ${phase}.`;
  return `An operation failed during ${phase}.`;
}

const detail: MarketplaceAgentDetail = {
  id: "receipt-listing",
  versionId: "receipt-listing-version-2",
  name: "Receipt Agent",
  title: "Receipt tester",
  description: "Test install receipts.",
  creatorName: "Test Author",
  version: 2,
  installs: 0,
  featured: false,
  avatarSeed: "receipt-agent",
  avatarHue: null,
  avatarUrl: null,
  skillCount: 1,
  routineCount: 1,
  activeRoutineCount: 1,
  updatedAt: "2026-10-17T00:00:00.000Z",
  skills: [
    {
      skillId: "receipt-skill",
      versionId: "receipt-skill-version-1",
      slug: "receipt-skill",
      name: "Skill",
      version: 1,
    },
  ],
  routines: [
    {
      name: "Daily check",
      instruction: "Check the receipts.",
      active: true,
      schedule: { kind: "interval", amount: 1, unit: "days", anchorAt: "2026-10-17T00:00:00.000Z" },
    },
  ],
};
const timezone = "UTC";
const report: { status: "running" | "pass" | "fail"; cases: CaseReport[] } = { status: "running", cases: [] };

function summary(id: string, workspace: string, values: Partial<AgentSummary>): AgentSummary {
  return {
    id,
    name: "Old name",
    title: "",
    description: "",
    notifications: false,
    provider: "codex",
    model: "gpt-5",
    reasoningEffort: "medium",
    threadId: null,
    workspacePath: workspace,
    preview: "",
    updatedAt: null,
    avatarSeed: id,
    avatarHue: null,
    avatarUrl: null,
    ...values,
  };
}

/** The saved state of an added agent: its profile, its marketplace source and its routines. */
function assertSaved(state: Pick<ScenarioState, "agents" | "routines">, agentId: string): AgentSummary {
  const agent = state.agents.get(agentId);
  assert.ok(agent);
  assert.equal(agent.name, detail.name);
  assert.equal(agent.title, detail.title);
  assert.equal(agent.description, detail.description);
  const source = agent.marketplaceSource;
  assert.ok(source);
  assert.equal(source.listingId, detail.id);
  assert.equal(source.versionId, detail.versionId);
  assert.equal(source.version, detail.version);
  assert.deepEqual(source.skillIds, [detail.skills[0]?.skillId]);
  assert.equal(source.routineIds.length, detail.routines.length);
  for (const routineId of source.routineIds) {
    const routine = state.routines.get(routineId);
    assert.ok(routine);
    assert.equal(routine.agentId, agentId);
    assert.equal(routine.name, detail.routines[0]?.name);
    assert.equal(routine.timezone, timezone);
  }
  return agent;
}

async function scenario(
  name: string,
  options: ScenarioOptions,
  check: (state: ScenarioState, input: InstallMarketplaceAgentInput) => Promise<void>,
): Promise<void> {
  const workspace = await mkdtemp(join(tmpdir(), "openbot-agent-receipt-"));
  const agents = new Map<string, AgentSummary>();
  const routines = new Map<string, RoutineInput>();
  const skillInstalls: string[] = [];
  const receipts: string[] = [];
  let phase = "service setup";
  let receiptAttempts = 0;
  class ReceiptAuth extends CentralAuthManager {
    override requestAuthorized<T>(
      path: string,
      init: RequestInit,
      decode: (value: unknown) => T,
    ): Effect.Effect<T, CentralAuthOperationError> {
      return Effect.gen(function* () {
        if (init.method === "GET") {
          assert.equal(path, `/v1/marketplace/agents/${detail.id}`);
          return decode(detail);
        }
        assert.equal(init.method, "POST");
        assert.equal(path, `/v1/marketplace/agents/${detail.id}/install`);
        receiptAttempts += 1;
        assert.ok(typeof init.body === "string", "Receipt body must be a string.");
        const { receiptId } = decodeReceipt(init.body);
        // The receipt is sent only after the agent is saved.
        const saved = [...agents.values()].filter((agent) => agent.marketplaceSource?.listingId === detail.id);
        assert.equal(saved.length, 1);
        assertSaved({ agents, routines }, saved[0]?.id ?? "");
        if (options.receiptDefect) return yield* Effect.die(new Error("Test receipt defect."));
        if (options.receiptInterrupt) return yield* Effect.interrupt;
        receipts.push(receiptId);
        if (options.receiptFailure) return yield* Effect.fail(new CentralAuthOperationError({ cause: "test-receipt" }));
        return decode({ installed: true });
      });
    }
  }
  const agentStore: AgentStore = {
    listAgents: () => [...agents.values()],
    listRoutines: () => [],
    resolveAvatar: () => null,
    createAgentProfile: (profile) =>
      Effect.sync(() => {
        const agent = summary(randomUUID(), workspace, profile);
        agents.set(agent.id, agent);
        return agent;
      }),
    updateAgent: ({ agentId, ...profile }) =>
      Effect.sync(() => {
        const agent = agents.get(agentId);
        assert.ok(agent);
        const next = { ...agent, ...profile };
        agents.set(agentId, next);
        return next;
      }),
    setAvatar: (agentId, image) =>
      Effect.sync(() => {
        assert.equal(image, null);
        const agent = agents.get(agentId);
        assert.ok(agent);
        return agent;
      }),
    createRoutine: (routine) => {
      const id = randomUUID();
      routines.set(id, routine);
      return { id };
    },
    deleteRoutine: ({ routineId }) => Effect.sync(() => void routines.delete(routineId)),
    setMarketplaceSource: (agentId, source) => {
      const agent = agents.get(agentId);
      assert.ok(agent);
      const next = { ...agent, marketplaceSource: source };
      agents.set(agentId, next);
      return next;
    },
    deleteAgent: (agentId) =>
      Effect.sync(() => {
        agents.delete(agentId);
        for (const [id, routine] of routines) if (routine.agentId === agentId) routines.delete(id);
      }),
  };
  const skillStore: SkillStore = {
    listPublishable: () => Effect.succeed([]),
    installVersion: ({ skillId, versionId }) =>
      options.skillFailure
        ? Effect.fail(new SkillMarketplaceFailure({ cause: "test-skill" }))
        : Effect.sync(() => void skillInstalls.push(`${skillId}@${versionId}`)),
    uninstall: () => Effect.void,
  };
  try {
    const auth = new ReceiptAuth({
      apiUrl: "https://example.invalid",
      storagePath: join(workspace, "auth.json"),
      canPersist: () => false,
      encrypt: (value) => Buffer.from(value),
      decrypt: (value) => value.toString("utf8"),
    });
    const service = new AgentMarketplaceService(auth, agentStore, skillStore);
    const input: InstallMarketplaceAgentInput = { listingId: detail.id, timezone, receiptId: randomUUID() };
    if (options.update) {
      const oldRoutineId = randomUUID();
      const old = summary("receipt-old-agent", workspace, {
        marketplaceSource: {
          listingId: detail.id,
          versionId: "receipt-listing-version-1",
          version: 1,
          skillIds: [],
          routineIds: [oldRoutineId],
        },
      });
      agents.set(old.id, old);
      routines.set(oldRoutineId, {
        agentId: old.id,
        name: "Old routine",
        instruction: "Run the old routine.",
        active: true,
        timezone,
        schedule: { kind: "interval", amount: 1, unit: "hours", anchorAt: "2026-10-01T00:00:00.000Z" },
      });
      input.agentId = old.id;
    }
    phase = "install";
    const result = await Effect.runPromiseExit(service.install(input));
    const state: ScenarioState = { service, result, agents, routines, skillInstalls, receipts };
    phase = "case checks";
    await check(state, input);
    phase = "receipt attempt count check";
    assert.equal(receiptAttempts, options.receiptAttempts ?? 1);
    report.cases.push({
      name,
      status: "pass",
      receiptAttempts,
      receipts: receipts.length,
      agents: agents.size,
      routines: routines.size,
    });
  } catch (error) {
    const reason = failureReason(error, phase);
    report.cases.push({
      name,
      status: "fail",
      reason,
      receiptAttempts,
      receipts: receipts.length,
      agents: agents.size,
      routines: routines.size,
    });
    process.stderr.write(`FAIL: ${name}: ${reason}\n`);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

function addedAgent(state: ScenarioState, input: InstallMarketplaceAgentInput): AgentSummary {
  assert.ok(Exit.isSuccess(state.result));
  const agent = assertSaved(state, state.result.value.agent.id);
  assert.deepEqual(state.result.value.agent, agent);
  assert.equal(state.agents.size, 1);
  assert.equal(state.routines.size, detail.routines.length);
  assert.deepEqual(state.skillInstalls, [`${detail.skills[0]?.skillId}@${detail.skills[0]?.versionId}`]);
  assert.deepEqual(state.receipts, [input.receiptId]);
  return agent;
}

/** A receipt that dies or is interrupted keeps its error path. The saved agent stays, as before. */
function keptAfterReceiptError(state: ScenarioState): void {
  assert.ok(Exit.isFailure(state.result));
  assert.equal(state.agents.size, 1);
  const [agent] = state.agents.values();
  assertSaved(state, agent?.id ?? "");
  assert.deepEqual(state.receipts, []);
}

await scenario("successful receipt", {}, async (state, input) => {
  addedAgent(state, input);
});
await scenario("failed receipt after commit", { receiptFailure: true }, async (state, input) => {
  const agent = addedAgent(state, input);
  // The listing shows the agent as added, so the user can only open or update it. The same version is
  // already saved: the service returns the agent and sends no second receipt.
  const again = await Effect.runPromise(
    state.service.install({ ...input, agentId: agent.id, receiptId: randomUUID() }),
  );
  assert.deepEqual(again.agent, agent);
  assert.equal(state.agents.size, 1);
  assert.deepEqual(state.receipts, [input.receiptId]);
});
await scenario("skill install failure", { skillFailure: true, receiptAttempts: 0 }, async (state) => {
  assert.ok(Exit.isFailure(state.result));
  assert.ok(!Exit.hasDies(state.result) && !Exit.hasInterrupts(state.result));
  assert.equal(state.agents.size, 0);
  assert.equal(state.routines.size, 0);
  assert.deepEqual(state.receipts, []);
});
await scenario("update sends no receipt", { update: true, receiptAttempts: 0 }, async (state, input) => {
  assert.ok(Exit.isSuccess(state.result));
  assert.equal(state.result.value.agent.id, input.agentId);
  assertSaved(state, input.agentId ?? "");
  assert.equal(state.agents.size, 1);
  assert.equal(state.routines.size, detail.routines.length);
  assert.deepEqual(state.receipts, []);
});
await scenario("receipt defect", { receiptDefect: true }, async (state) => {
  assert.ok(Exit.hasDies(state.result));
  keptAfterReceiptError(state);
});
await scenario("receipt interruption", { receiptInterrupt: true }, async (state) => {
  assert.ok(Exit.hasInterrupts(state.result));
  keptAfterReceiptError(state);
});

report.status = report.cases.every((item) => item.status === "pass") ? "pass" : "fail";
await mkdir(".openbot-build", { recursive: true });
await writeFile(".openbot-build/agent-install-receipt-e2e.json", `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report)}\n`);
process.exitCode = report.status === "pass" ? 0 : 1;
