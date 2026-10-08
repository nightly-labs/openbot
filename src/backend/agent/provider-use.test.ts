import { Deferred, Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentLifecycleFailed, type AgentService } from "../agent-service";
import {
  CREATE_AGENT_INPUT,
  createTestService,
  FakeAgentClient,
  startAgentTestFixture,
  stopAgentTestFixture,
  stores,
} from "../agent-service-test-harness";
import { runCauseEffect } from "../effect-boundary";

let root: string;
let service: AgentService | null = null;
beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});
afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

describe("provider switches", () => {
  it("does not start an off CLI, restores its models on enable, and removes them on disable", async () => {
    const state = stores(root);
    const clients: FakeAgentClient[] = [];
    const save = vi.fn(() => Effect.void);
    service = createTestService({
      ...state,
      offProviders: ["codex"],
      saveProviderUse: save,
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider);
        clients.push(client);
        return client;
      },
    });
    await runCauseEffect(service.initialize());
    await runCauseEffect(service.refreshProviders());
    expect(clients.filter((client) => client.provider === "codex")).toHaveLength(0);
    expect(service.listModels().filter((model) => model.provider === "codex")).toEqual([]);
    await expect(runCauseEffect(service.connectProvider("codex", vi.fn()))).rejects.toThrow("is off in OpenBot");
    await runCauseEffect(service.setProviderOn("codex", true));
    expect(service.listModels().some((model) => model.provider === "codex")).toBe(true);
    await runCauseEffect(service.setProviderOn("codex", false));
    await runCauseEffect(service.refreshProviders());
    expect(clients.filter((client) => client.provider === "codex")).toHaveLength(1);
    expect(clients.every((client) => !client.running)).toBe(true);
    expect(service.listModels().filter((model) => model.provider === "codex")).toEqual([]);
    expect(service.getStatus().providers).toContainEqual({
      id: "codex",
      state: "not-started",
      version: null,
      message: null,
      off: true,
    });
    expect(save.mock.calls).toEqual([
      ["codex", true],
      ["codex", false],
    ]);
  });

  it("refuses to remove an agent's provider and keeps its model and identity", async () => {
    const state = stores(root);
    const save = vi.fn(() => Effect.void);
    service = createTestService({
      ...state,
      saveProviderUse: save,
      clientFactory: (provider) => new FakeAgentClient(provider),
    });
    await runCauseEffect(service.initialize());
    await runCauseEffect(state.store.getOrCreate("chief"));
    const before = service.listAgents();
    await expect(runCauseEffect(service.setProviderOn("codex", false))).rejects.toThrow("An agent uses");
    expect(service.listAgents()).toEqual(before);
    expect(save).not.toHaveBeenCalled();
    expect(service.listModels().some((model) => model.provider === "codex")).toBe(true);
  });

  it("keeps the live provider and models when saving fails", async () => {
    const state = stores(root);
    const clients: FakeAgentClient[] = [];
    service = createTestService({
      ...state,
      saveProviderUse: () =>
        Effect.fail(new AgentLifecycleFailed({ operation: "saveProviderUse", cause: new Error("write failed") })),
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider);
        clients.push(client);
        return client;
      },
    });
    await runCauseEffect(service.initialize());
    await expect(runCauseEffect(service.setProviderOn("codex", false))).rejects.toThrow("write failed");
    expect(clients.find((client) => client.provider === "codex")?.running).toBe(true);
    expect(service.listModels().some((model) => model.provider === "codex")).toBe(true);
    expect(service.getStatus().providers?.find((row) => row.id === "codex")?.off).not.toBe(true);
  });
  it("cannot assign a new agent while its provider is being switched off", async () => {
    const state = stores(root);
    const saving = Deferred.makeUnsafe<void>();
    const finishSave = Deferred.makeUnsafe<void>();
    service = createTestService({
      ...state,
      saveProviderUse: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(saving, undefined);
          yield* Deferred.await(finishSave);
        }),
      clientFactory: (provider) => new FakeAgentClient(provider),
    });
    await runCauseEffect(service.initialize());
    const switching = runCauseEffect(service.setProviderOn("codex", false));
    await runCauseEffect(Deferred.await(saving));
    const creation = runCauseEffect(service.createAgentProfile({ ...CREATE_AGENT_INPUT, provider: "codex" }));
    const rejected = expect(creation).rejects.toThrow();
    await runCauseEffect(Deferred.succeed(finishSave, undefined));
    await switching;
    await rejected;
    expect(service.listAgents()).toEqual([]);
    expect(service.listModels().some((model) => model.provider === "codex")).toBe(false);
  });
});
