// @vitest-environment node
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentMemoryStore } from "../agent-memory-store";
import { AgentRoutineStore } from "../agent-routine-store";
import type { AgentService } from "../agent-service";
import {
  createTestService,
  EMPTY_LAYOUT,
  FakeAgentClient,
  startAgentTestFixture,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "../agent-service-test-harness";
import { runCauseEffect } from "../effect-boundary";
import { StoredStateFailure } from "../stored-state-effects";

let root: string;
let service: AgentService | null = null;

beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});

afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

describe.sequential("DuplicationGate: copying an agent and the pending window", () => {
  it("duplicates persistent agent data without conversation or routine-run history", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    await runCauseEffect(service.initialize());
    const source = await runCauseEffect(store.getOrCreate("chief", "Research", "Research lead"));
    await runCauseEffect(
      store.updateAgent({
        agentId: source.id,
        description: "Finds primary sources.",
        notifications: false,
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
      }),
    );
    await writeFile(join(source.workspacePath, "research.md"), "source workspace\n");
    service.createMemory({ agentId: source.id, text: "Use official documents." });
    new AgentMemoryStore(store.database).saveAutomatic({
      agentId: source.id,
      text: "The user prefers short briefs.",
      sourceTurnId: "turn-source-memory",
    });
    const activeRoutine = service.createRoutine({
      agentId: source.id,
      name: "Morning brief",
      instruction: "Prepare the morning brief.",
      active: true,
      timezone: "Europe/Warsaw",
      schedule: { kind: "daily", time: "09:00" },
    });
    const inactiveRoutine = service.createRoutine({
      agentId: source.id,
      name: "Weekly review",
      instruction: "Review the week.",
      active: false,
      timezone: "UTC",
      schedule: { kind: "weekly", weekday: 1, time: "10:30" },
    });
    const routineStore = new AgentRoutineStore(store.database);
    const oldRun = routineStore.createRun(
      activeRoutine,
      activeRoutine.trigger.id,
      "scheduled",
      "2026-08-31T07:00:00.000Z",
    );
    routineStore.updateRunStatus(oldRun.id, "succeeded");
    service.setMarketplaceSource(source.id, {
      listingId: "market-research",
      versionId: "market-research-v2",
      version: 2,
      skillIds: ["primary-sources"],
      routineIds: [activeRoutine.id],
    });
    const duplicateStartedAt = Date.now();
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));

    const duplicate = await runCauseEffect(service.duplicateAgent(source.id));

    expect(service.listAgents().some((agent) => agent.id === duplicate.id)).toBe(false);
    await expect(
      runCauseEffect(service.sendMessage({ agentId: duplicate.id, text: "Do not start yet." })),
    ).rejects.toThrow(`Unknown agent: ${duplicate.id}`);
    await expect(runCauseEffect(service.updateAgent({ agentId: duplicate.id, title: "Hidden copy" }))).rejects.toThrow(
      `Unknown agent: ${duplicate.id}`,
    );
    expect(service.listQueue(duplicate.id).deliveries).toEqual([]);
    expect(events).toEqual([]);
    await runCauseEffect(service.commitAgentDuplication(duplicate.id, EMPTY_LAYOUT));
    expect(service.listAgents().some((agent) => agent.id === duplicate.id)).toBe(true);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "agents-changed" }),
        expect.objectContaining({ type: "memories-changed", agentId: duplicate.id }),
        expect.objectContaining({ type: "routines-changed", agentId: duplicate.id }),
      ]),
    );

    expect(duplicate.id).not.toBe(source.id);
    expect(duplicate).toMatchObject({
      name: "Research copy",
      title: "Research lead",
      description: "Finds primary sources.",
      notifications: false,
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      threadId: null,
      preview: "No messages yet",
    });
    expect((await runCauseEffect(service.readConversation(duplicate.id))).messages).toEqual([]);
    await expect(readFile(join(duplicate.workspacePath, "research.md"), "utf8")).resolves.toBe("source workspace\n");

    const sourceMemories = service.listMemories(source.id);
    const duplicateMemories = service.listMemories(duplicate.id);
    expect(
      duplicateMemories
        .map(({ text, origin, sourceTurnId }) => ({ text, origin, sourceTurnId }))
        .sort((left, right) => left.text.localeCompare(right.text)),
    ).toEqual(
      sourceMemories
        .map(({ text, origin }) => ({ text, origin, sourceTurnId: null }))
        .sort((left, right) => left.text.localeCompare(right.text)),
    );
    expect(new Set(duplicateMemories.map((memory) => memory.id))).not.toEqual(
      new Set(sourceMemories.map((memory) => memory.id)),
    );

    const sourceRoutines = service.listRoutines(source.id);
    const duplicateRoutines = service.listRoutines(duplicate.id);
    expect(
      duplicateRoutines
        .map(({ name, instruction, active, timezone, trigger }) => ({
          name,
          instruction,
          active,
          timezone,
          schedule: trigger.schedule,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    ).toEqual(
      sourceRoutines
        .map(({ name, instruction, active, timezone, trigger }) => ({
          name,
          instruction,
          active,
          timezone,
          schedule: trigger.schedule,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    );
    expect(duplicateRoutines.every((routine) => Date.parse(routine.trigger.nextRunAt) >= duplicateStartedAt)).toBe(
      true,
    );
    expect(duplicateRoutines.map((routine) => routine.id)).not.toEqual(sourceRoutines.map((routine) => routine.id));
    for (const routine of duplicateRoutines) {
      expect(service.listRoutineRuns({ agentId: duplicate.id, routineId: routine.id, limit: 10 })).toEqual([]);
    }
    expect(duplicate.marketplaceSource).toMatchObject({
      listingId: "market-research",
      skillIds: ["primary-sources"],
      routineIds: [duplicateRoutines.find((routine) => routine.name === activeRoutine.name)?.id],
    });

    await writeFile(join(duplicate.workspacePath, "research.md"), "duplicate workspace\n");
    await service.updateMemory({
      agentId: duplicate.id,
      memoryId: duplicateMemories[0]?.id ?? "missing",
      text: "Changed only in the duplicate.",
    });
    const copiedActiveRoutine = duplicateRoutines.find((routine) => routine.name === activeRoutine.name);
    if (!copiedActiveRoutine) throw new Error("The duplicated active routine is missing.");
    service.updateRoutine({ agentId: duplicate.id, routineId: copiedActiveRoutine.id, active: false });

    await expect(readFile(join(source.workspacePath, "research.md"), "utf8")).resolves.toBe("source workspace\n");
    expect(service.listMemories(source.id).some((memory) => memory.text === "Changed only in the duplicate.")).toBe(
      false,
    );
    expect(service.listRoutines(source.id).find((routine) => routine.id === activeRoutine.id)?.active).toBe(true);
    expect(service.listRoutines(source.id).find((routine) => routine.id === inactiveRoutine.id)?.active).toBe(false);
  });

  it("blocks duplication while the source agent has active work", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    await runCauseEffect(service.initialize());
    await runCauseEffect(store.getOrCreate("chief"));
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Keep working.", attachmentDraftIds: [] }));

    await expect(runCauseEffect(service.duplicateAgent("chief"))).rejects.toThrow("finish and clear its queue");
    expect(store.list().map((agent) => agent.id)).toEqual(["chief"]);
  });

  it("serializes duplication until the previous copy is committed", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    await runCauseEffect(service.initialize());
    await runCauseEffect(store.getOrCreate("chief"));
    await runCauseEffect(store.getOrCreate("research"));
    const first = await runCauseEffect(service.duplicateAgent("chief"));
    let secondResolved = false;
    const secondRequest = runCauseEffect(service.duplicateAgent("research")).then((duplicate) => {
      secondResolved = true;
      return duplicate;
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(secondResolved).toBe(false);
    await runCauseEffect(service.commitAgentDuplication(first.id, EMPTY_LAYOUT));
    const second = await secondRequest;
    await runCauseEffect(service.commitAgentDuplication(second.id, EMPTY_LAYOUT));
    expect(service.listAgents().map((agent) => agent.id)).toEqual(
      expect.arrayContaining(["chief", "research", first.id, second.id]),
    );
  });

  it("holds the source queue for the length of the copy, then answers what waited", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => {
        return new FakeAgentClient(provider);
      },
    });
    await runCauseEffect(service.initialize());
    const source = await runCauseEffect(store.getOrCreate("chief"));
    await writeFile(join(source.workspacePath, "research.md"), "source workspace\n");
    const duplicateInStore = store.duplicateAgent.bind(store);
    vi.spyOn(store, "duplicateAgent").mockImplementationOnce((agentId, operationId) =>
      Effect.gen(function* () {
        const duplicate = yield* duplicateInStore(agentId, operationId);
        // A message landing while the workspace is still being copied. The source is muted, so
        // nothing schedules a drain for it and only the mute lifting can start this turn.
        if (service)
          yield* service
            .sendMessage({ agentId: source.id, text: "Anything on the sources?" })
            .pipe(Effect.mapError((failure) => new StoredStateFailure({ cause: failure.cause })));
        expect(service?.listQueue(source.id).deliveries[0]?.status).toBe("queued");
        return duplicate;
      }),
    );

    const duplicate = await runCauseEffect(service.duplicateAgent(source.id));
    await runCauseEffect(service.commitAgentDuplication(duplicate.id, EMPTY_LAYOUT));

    await waitFor(() => service?.listQueue(source.id).deliveries[0]?.status === "completed");
    await expect(readFile(join(duplicate.workspacePath, "research.md"), "utf8")).resolves.toBe("source workspace\n");
  });

  it("removes copied data when the source changes during duplication", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    await runCauseEffect(service.initialize());
    await runCauseEffect(store.getOrCreate("chief"));
    const duplicateInStore = store.duplicateAgent.bind(store);
    vi.spyOn(store, "duplicateAgent").mockImplementationOnce((agentId) =>
      Effect.gen(function* () {
        const duplicate = yield* duplicateInStore(agentId);
        service?.createMemory({ agentId, text: "Changed during duplication." });
        return duplicate;
      }),
    );

    await expect(runCauseEffect(service.duplicateAgent("chief"))).rejects.toThrow(
      "changed while it was being duplicated",
    );

    expect(store.list().map((agent) => agent.id)).toEqual(["chief"]);
    expect(service.listMemories("chief")).toEqual([expect.objectContaining({ text: "Changed during duplication." })]);
  });
});
