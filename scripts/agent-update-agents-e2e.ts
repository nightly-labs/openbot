// Checks the `update_agents` tool of issue #2835 on the real SQLite agent store: a coordinator gives
// several agents one setting in one call and reads the result for each agent. One agent that has a
// turn refuses a provider change the way AgentService does, an unknown id and a request to widen
// access fail for that agent only, and the other agents are still changed. A model that is not listed
// fails the whole call. Each call goes through `handleUpdateAgentsTool`, as the tool router sends it,
// and a failed call becomes the correctable tool failure of the router. No provider, account or
// network is started.
// Run: `bun scripts/agent-update-agents-e2e.ts`.
// Writes .openbot-build/agent-update-agents-e2e/report.json.

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentModelOption, UpdateAgentInput } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { profileToolErrorMessage } from "../src/backend/agent/profile-tools";
import { openBotToolFailure } from "../src/backend/agent/routine-tools";
import { ToolOperationFailed } from "../src/backend/agent/tool-operation";
import { handleUpdateAgentsTool } from "../src/backend/agent/update-agents-tool";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "agent-update-agents-e2e");
const NEW_MODEL = "gpt-e2e-new";

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

const root = await mkdtemp(join(tmpdir(), "openbot-update-agents-"));
const database = new OpenBotDatabase(join(root, "state"));
const store = new AgentStore(join(root, "state"), join(root, "home"), database);
const busyAgentIds = new Set<string>();
const writes: UpdateAgentInput[] = [];

try {
  await runCauseEffect(store.initialize());
  const create = (name: string, avatarSeed: string) =>
    runCauseEffect(store.createAgent({ name, description: "", avatarSeed, avatarHue: null }));
  const coordinator = await create("Coordinator", "bulk-a");
  const writer = await create("Writer", "bulk-b");
  const reviewer = await create("Reviewer", "bulk-c");
  const tester = await create("Tester", "bulk-d");
  const models: AgentModelOption[] = [
    {
      provider: writer.provider,
      id: writer.model,
      name: "Current",
      description: "",
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: ["low", "medium", "high"],
    },
    {
      provider: writer.provider,
      id: NEW_MODEL,
      name: "New",
      description: "",
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: ["low", "medium", "high"],
    },
  ];

  const hooks = {
    listAgents: () => store.list(),
    listModels: () => models,
    // The tool mock refuses a model change while the agent has a turn, so the call reports that agent.
    updateAgent: (input: UpdateAgentInput, initiatingAgentId: string) =>
      busyAgentIds.has(input.agentId) && input.model !== undefined
        ? Effect.fail(new ToolOperationFailed({ cause: new Error(sourceText("error.agent.waitBeforeProviderChange")) }))
        : store.updateAgent(input, initiatingAgentId).pipe(
            Effect.tap(() => Effect.sync(() => writes.push(input))),
            Effect.mapError((failure) => new ToolOperationFailed({ cause: failure.cause })),
          ),
    redactMcp: (text: string) => text,
  };

  /** One `update_agents` call from the coordinator, answered as the tool router answers it. */
  const call = async (args: unknown): Promise<{ success: boolean; value: DynamicRecord }> => {
    const response = await Effect.runPromise(
      handleUpdateAgentsTool(
        { threadId: "t", turnId: "turn", callId: "c", namespace: "openbot", tool: "update_agents", arguments: args },
        coordinator.id,
        hooks,
      ).pipe(Effect.catch((failure) => Effect.succeed(openBotToolFailure(profileToolErrorMessage(failure.cause))))),
    );
    const item = response.contentItems[0];
    assert.ok(item && item.type === "inputText", "The answer is text.");
    const value = JSON.parse(item.text);
    assert.ok(isDynamicRecord(value), "The answer is a JSON object.");
    return { success: response.success, value };
  };
  const agent = (id: string) => {
    const found = store.list().find((candidate) => candidate.id === id);
    assert.ok(found, `Agent ${id} exists.`);
    return found;
  };

  await step("One call moves three agents to a new model", async () => {
    const { success, value } = await call({
      agentIds: [writer.id, reviewer.id, tester.id],
      model: NEW_MODEL,
      reasoningEffort: "high",
    });
    assert.equal(success, true);
    assert.equal(value.updated, 3);
    assert.equal(value.failed, 0);
    for (const id of [writer.id, reviewer.id, tester.id]) {
      assert.equal(agent(id).model, NEW_MODEL);
      assert.equal(agent(id).reasoningEffort, "high");
    }
    assert.equal(agent(coordinator.id).model, coordinator.model, "An agent not in the list keeps its model.");
    return value;
  });

  await step("An unknown id and a busy agent fail, and the other agent is changed", async () => {
    busyAgentIds.add(reviewer.id);
    const { success, value } = await call({
      agentIds: [writer.id, "no-such-agent", reviewer.id],
      model: writer.model,
      notifications: false,
    });
    busyAgentIds.clear();
    assert.equal(success, true);
    assert.equal(value.updated, 1);
    assert.equal(value.failed, 2);
    assert.deepEqual(
      Array.isArray(value.results) && value.results.map((result) => isDynamicRecord(result) && result.agentId),
      [writer.id, "no-such-agent", reviewer.id],
      "The results keep the order of the request.",
    );
    const [first, unknown, busy] = Array.isArray(value.results) ? value.results.filter(isDynamicRecord) : [];
    assert.equal(first?.ok, true);
    assert.equal(first?.notifications, false, "The result has the agent's new settings.");
    assert.equal("description" in (first ?? {}), false, "The result leaves out the agent's instructions.");
    assert.equal(unknown?.error, sourceText("error.agent.unknown", { id: "no-such-agent" }));
    assert.equal(busy?.error, sourceText("error.agent.waitBeforeProviderChange"));
    assert.equal(agent(writer.id).notifications, false);
    assert.equal(agent(writer.id).model, writer.model);
    assert.notEqual(agent(reviewer.id).notifications, false, "The busy agent keeps all its settings.");
    assert.equal(agent(reviewer.id).model, NEW_MODEL);
    return value;
  });

  await step("Agents restrict access and Computer Use, and a request to widen fails for that agent", async () => {
    const restricted = await call({ agentIds: [reviewer.id, tester.id], access: "workspace", computerUse: false });
    assert.equal(restricted.value.updated, 2);
    for (const id of [reviewer.id, tester.id]) {
      assert.equal(agent(id).access, "workspace");
      assert.equal(agent(id).computerUse, false);
    }
    const before = writes.length;
    const widened = await call({ agentIds: [writer.id, tester.id], access: "full" });
    assert.equal(widened.value.updated, 1, "The agent that already has Full access counts as updated.");
    const results = Array.isArray(widened.value.results) ? widened.value.results.filter(isDynamicRecord) : [];
    assert.equal(results[1]?.error, sourceText("error.agent.onlyUserWidensSettings"));
    assert.equal(agent(tester.id).access, "workspace");
    assert.ok(
      writes.slice(before).every((input) => input.agentId !== tester.id && input.access === undefined),
      "Nothing is written for the refused agent, and Full access is never written.",
    );
    return { restricted: restricted.value, widened: widened.value };
  });

  await step("A model that is not listed fails the whole call once and changes nothing", async () => {
    const before = writes.length;
    const { success, value } = await call({ agentIds: [writer.id, tester.id], model: "no-such-model" });
    assert.equal(success, false);
    assert.match(String(value.error), /no-such-model/);
    assert.equal(writes.length, before);
    return value;
  });

  await step("A call with no agents, a repeated id, no setting or an unknown field is refused", async () => {
    const refusals = {
      noAgents: await call({ agentIds: [], notifications: true }),
      repeated: await call({ agentIds: [writer.id, writer.id], notifications: true }),
      noSetting: await call({ agentIds: [writer.id] }),
      unknownField: await call({ agentIds: [writer.id], providerAccountId: "default" }),
    };
    for (const [name, refusal] of Object.entries(refusals)) {
      assert.equal(refusal.success, false, `${name} is refused.`);
      assert.equal(typeof refusal.value.error, "string");
    }
    assert.match(String(refusals.repeated.value.error), /each agent id once/);
    assert.match(String(refusals.unknownField.value.error), /Remove unsupported profile fields/);
    return Object.fromEntries(Object.entries(refusals).map(([name, refusal]) => [name, refusal.value.error]));
  });

  report.passed = true;
} finally {
  database.close();
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
}
