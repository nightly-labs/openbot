// @vitest-environment node
import { createHash } from "node:crypto";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProvider } from "./agent-client";
import type { AgentService } from "./agent-service";
import {
  createFakeClaude,
  createFakeGrok,
  createFakeOpencode,
  createTestService,
  FakeAgentClient,
  notification,
  paramsRecord,
  startAgentTestFixture,
  startService,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "./agent-service-test-harness";
import { loginShellPath } from "./mcp-provider-shapes";

let root: string;
let service: AgentService | null = null;

/**
 * What a stdio MCP server is launched with: this user's own `PATH`, then the configuration's pairs.
 * The `PATH` is what makes a command found through a login shell runnable outside a terminal.
 */
async function launchEnvironment(pairs: Record<string, string> = {}): Promise<Record<string, string>> {
  const path = await loginShellPath();
  return { ...(path ? { PATH: path } : {}), ...pairs };
}

beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});

afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

describe.sequential("AgentService: providers (2/3)", () => {
  it("keeps a session routed while an unconfirmed turn start waits", async () => {
    const { store, mailbox } = stores(root);
    let timedOut = false;
    const client = new FakeAgentClient("codex", "CODEX_DONE", true, true, {}, async (method) => {
      if (method !== "turn/start" || timedOut) return;
      timedOut = true;
      throw new Error("Codex request timed out: turn/start");
    });
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: () => client,
    });
    await service.initialize();
    const errors: string[] = [];
    service.on("event", (event) => {
      if (event.type === "error") errors.push(event.code);
    });

    await service.sendMessage({ agentId: "chief", text: "Start." });
    await waitFor(() => errors.includes("delivery_start_unconfirmed"));
    const session = store.activeProviderSession("chief")?.externalSessionId;
    if (!session) throw new Error("The unconfirmed start left no provider session.");

    service.saveMcpServer({
      config: {
        id: "",
        name: "Filesystem",
        transport: "stdio",
        enabled: true,
        command: "/bin/echo",
        args: ["ready"],
        env: [],
        envPassthrough: [],
        workingDirectory: "",
        url: "",
        headers: [],
      },
    });
    expect(client.releasedThreads).toEqual([]);

    // The turn the provider did start after all, reported the only way it can be: its events.
    const turnId = "turn-after-the-timeout";
    client.emit("notification", notification("turn/started", { threadId: session, turn: { id: turnId } }));
    client.emit(
      "notification",
      notification("turn/completed", { threadId: session, turn: { id: turnId, status: "completed" } }),
    );

    await waitFor(() => service?.listQueue("chief").deliveries.every((delivery) => delivery.status === "completed"));
  });

  // The manifest is the only record that survives a restart, and the in-memory refresh mark does
  // not. A manifest written from the set that arrived during the start would describe a session
  // that never got it, and the resume check would then accept that session for good.
  it("records the MCP set a session was given, not one that arrived while it started", async () => {
    const { store, mailbox } = stores(root);
    let started = false;
    const client = new FakeAgentClient("codex", "CODEX_DONE", true, true, {}, async (method) => {
      if (method !== "thread/start" || started) return;
      started = true;
      service?.saveMcpServer({
        config: {
          id: "",
          name: "Filesystem",
          transport: "stdio",
          enabled: true,
          command: "/bin/echo",
          args: ["ready"],
          env: [],
          envPassthrough: [],
          workingDirectory: "",
          url: "",
          headers: [],
        },
      });
    });
    const start = async () => {
      const next = createTestService({
        store,
        mailbox,
        preferredProvider: "codex",
        clientFactory: () => client,
      });
      await next.initialize();
      return next;
    };
    service = await start();
    await service.sendMessage({ agentId: "chief", text: "Start." });
    await waitFor(() => service?.listQueue("chief").deliveries.every((delivery) => delivery.status === "completed"));
    const firstSession = store.activeProviderSession("chief")?.externalSessionId;

    // The restart drops the held refresh, so the manifest alone decides whether the session is kept.
    await service.stop();
    service = await start();
    await service.sendMessage({ agentId: "chief", text: "Continue." });
    await waitFor(() =>
      service?.listQueue("chief").deliveries.every((delivery) => ["completed", "failed"].includes(delivery.status)),
    );

    expect(store.activeProviderSession("chief")?.externalSessionId).not.toBe(firstSession);
    const starts = client.requests.filter((request) => request.method === "thread/start");
    expect(starts).toHaveLength(2);
    expect(paramsRecord(starts[1]?.params)?.config).toEqual({
      mcp_servers: { Filesystem: { command: "/bin/echo", args: ["ready"], env: await launchEnvironment() } },
    });
  });

  it("deletes unloaded pending handoffs for active and retired sessions with their agent", async () => {
    const { store, mailbox } = stores(root);
    let rejectTurn = false;
    const client = new FakeAgentClient("codex", "DONE", true, true, {}, async (method) => {
      if (rejectTurn && method === "turn/start") throw new Error("Turn rejected.");
    });
    const start = async () => {
      const next = createTestService({
        store,
        mailbox,
        preferredProvider: "codex",
        clientFactory: () => client,
      });
      await next.initialize();
      return next;
    };
    service = await start();
    await service.sendMessage({ agentId: "chief", text: "Private conversation to remove with this agent." });
    await waitFor(() => service?.listQueue("chief").deliveries.every((delivery) => delivery.status === "completed"));
    const manifests = join(store.database.userDataPath, "provider-toolsets");
    const handoffs = join(store.database.userDataPath, "provider-handoffs");
    rejectTurn = true;
    for (const attempt of [1, 2]) {
      await service.stop();
      for (const file of await readdir(manifests)) await writeFile(join(manifests, file), "outdated");
      service = await start();
      await service.sendMessage({ agentId: "chief", text: `Continue ${attempt}` });
      await waitFor(
        () =>
          service?.listQueue("chief").deliveries.filter((delivery) => delivery.status === "failed").length === attempt,
      );
    }
    const recordedHandoffs = await readdir(handoffs);
    const recordedManifests = await readdir(manifests);
    expect(recordedHandoffs).toHaveLength(2);
    await service.stop();
    const orphan = createHash("sha256").update("unrecorded-session").digest("hex");
    await writeFile(join(handoffs, orphan), "Private history written before a crash.");
    await writeFile(join(manifests, orphan), "unrecorded-toolset");
    service = await start();
    expect(await readdir(handoffs)).toEqual(recordedHandoffs);
    expect(await readdir(manifests)).toEqual(recordedManifests);
    await service.deleteAgent("chief");
    expect(await readdir(handoffs)).toEqual([]);
    expect(await readdir(manifests)).toEqual([]);
    expect(service.listAgents().some((agent) => agent.id === "chief")).toBe(false);
  });

  it("removes private handoff files immediately when replacement session binding fails", async () => {
    const { service: agentService, store } = await startService(root, {
      provider: "codex",
      preferredProvider: "codex",
    });
    service = agentService;
    await service.sendMessage({ agentId: "chief", text: "Private history for the replacement session." });
    await waitFor(() => service?.listQueue("chief").deliveries.every((delivery) => delivery.status === "completed"));
    const original = store.activeProviderSession("chief")?.externalSessionId;
    const manifests = join(store.database.userDataPath, "provider-toolsets");
    const recorded = await readdir(manifests);
    for (const file of recorded) await writeFile(join(manifests, file), "outdated");
    const binding = vi.spyOn(store, "bindProviderSession").mockImplementationOnce(() => {
      throw new Error("Session binding failed.");
    });
    try {
      await service.sendMessage({ agentId: "chief", text: "Continue with new tools." });
      await waitFor(() => service?.listQueue("chief").deliveries.some((delivery) => delivery.status === "failed"));
      expect(store.activeProviderSession("chief")?.externalSessionId).toBe(original);
      expect(await readdir(join(store.database.userDataPath, "provider-handoffs"))).toEqual([]);
      expect(await readdir(manifests)).toEqual(recorded);
    } finally {
      binding.mockRestore();
    }
  });

  it.each<AgentProvider>(["codex", "claude", "grok", "opencode"])(
    "delivers the quiet collaboration policy to %s on startup and after restart",
    async (provider) => {
      process.env.OPENBOT_CLAUDE_PATH = await createFakeClaude(root);
      process.env.OPENBOT_GROK_PATH = await createFakeGrok(root);
      process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
      const { store, mailbox } = stores(root);
      for (const method of ["thread/start", "thread/resume"]) {
        const clients = new Map<AgentProvider, FakeAgentClient>();
        service = createTestService({
          store,
          mailbox,
          preferredProvider: provider,
          clientFactory: (selectedProvider) => {
            const client = new FakeAgentClient(selectedProvider);
            clients.set(selectedProvider, client);
            return client;
          },
        });
        await service.initialize();
        if (method === "thread/start") {
          await store.getOrCreate("chief");
          await service.updateAgent({
            agentId: "chief",
            provider,
            model:
              provider === "codex"
                ? "gpt-5.6-luna"
                : provider === "claude"
                  ? "claude-sonnet-5"
                  : provider === "grok"
                    ? "grok-4.5"
                    : "opencode/example-model",
          });
        }
        await service.sendMessage({ agentId: "chief", text: "Continue coordinating the research task." });
        await waitFor(() =>
          service?.listQueue("chief").deliveries.every((delivery) => delivery.status === "completed"),
        );

        const request = clients.get(provider)?.requests.find((candidate) => candidate.method === method);
        const instructions = paramsRecord(request?.params)?.developerInstructions;
        expect(instructions).toContain("Keep routine teammate communication internal");
        expect(instructions).toContain("On startup or resume, begin or continue the task without narrating setup");
        expect(instructions).toContain(
          "Report meaningful outcomes, completed work, material changes, blockers, failures",
        );
        expect(instructions).toContain("required user input or approval");
        expect(instructions).toContain("If the user asks for a detailed coordination report, provide it");
        expect(instructions).toContain("send the result back in the Status/Result/Evidence format");
        expect(instructions).toContain("Do not create acknowledgement loops");
        expect(instructions).not.toContain("When you receive a reply, summarize it for the user");
        await service.stop();
      }
    },
  );

  it("moves an agent off a removed endpoint onto a model OpenCode still lists", async () => {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    const { service: agentService, store } = await startService(root, {
      client: (provider) => {
        const client = new FakeAgentClient(provider);
        // OpenCode reports a custom endpoint's model as `<endpoint id>/<model id>`, beside its own.
        if (provider === "opencode") {
          client.modelList = () => ({ data: [{ model: "opencode/example-model" }, { model: "lmstudio/local-llm" }] });
        }
        return client;
      },
      preferredProvider: "opencode",
    });
    service = agentService;
    await store.getOrCreate("chief");
    await service.updateAgent({ agentId: "chief", provider: "opencode", model: "lmstudio/local-llm" });

    await service.removeCustomProvider("lmstudio", async () => undefined);

    // OpenCode declares no default model of its own, so the fallback has to be read from what it
    // lists. An empty model id is refused by `updateAgent`, and that refusal reached the user as a
    // failed removal with the endpoint still saved.
    expect(service.listAgents().find((agent) => agent.id === "chief")).toMatchObject({
      provider: "opencode",
      model: "opencode/example-model",
    });
  });

  // The catalogue is the running CLI's answer, and a removal during a turn does not restart it. The
  // models of an endpoint already removed are therefore still listed, and must not be chosen.
  it("never falls back onto an endpoint removed earlier in the same OpenCode process", async () => {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    const { service: agentService, store } = await startService(root, {
      client: (provider) => {
        const client = new FakeAgentClient(provider);
        // Two endpoints and no OpenCode model of its own, so the fallback for one removal is the other
        // endpoint, and the fallback for the second removal must leave OpenCode altogether.
        if (provider === "opencode") {
          client.modelList = () => ({ data: [{ model: "studio/local-llm" }, { model: "house/router-llm" }] });
        }
        return client;
      },
      preferredProvider: "opencode",
    });
    service = agentService;
    await service.ensureProvider("codex");
    await store.getOrCreate("chief");
    await service.updateAgent({ agentId: "chief", provider: "opencode", model: "studio/local-llm" });

    await service.removeCustomProvider("studio", async () => undefined);
    expect(service.listAgents().find((agent) => agent.id === "chief")).toMatchObject({
      model: "house/router-llm",
    });

    await service.removeCustomProvider("house", async () => undefined);

    const chief = service.listAgents().find((agent) => agent.id === "chief");
    expect(chief?.model).not.toBe("studio/local-llm");
    expect(chief?.provider).toBe("codex");
  });

  // A user who runs custom endpoints only has no other provider to move to. The removal must still
  // go through, or the last endpoint can never be taken out.
  it("removes the last endpoint when the built-in provider cannot be reached", async () => {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    // No Codex CLI, so the built-in fallback reports `not-installed` and connecting to it throws.
    process.env.OPENBOT_CODEX_PATH = join(root, "absent-codex");
    const { service: agentService, store } = await startService(root, {
      client: (provider) => {
        const client = new FakeAgentClient(provider);
        // Every OpenCode model belongs to the endpoint being removed, so there is nothing to move to.
        if (provider === "opencode") client.modelList = () => ({ data: [{ model: "lmstudio/local-llm" }] });
        return client;
      },
      preferredProvider: "opencode",
    });
    service = agentService;
    await store.getOrCreate("chief");
    await service.updateAgent({ agentId: "chief", provider: "opencode", model: "lmstudio/local-llm" });

    await service.removeCustomProvider("lmstudio", async () => undefined);

    // The agent keeps its model: the endpoint is gone, and the next OpenCode start decides what it
    // can still serve. A refusal here would trap the user on an endpoint they asked to remove.
    expect(service.listAgents().find((agent) => agent.id === "chief")).toMatchObject({
      provider: "opencode",
      model: "lmstudio/local-llm",
    });

    // The running OpenCode process still serves the removed endpoint, with the credentials it
    // started with, so a later message must not reach it.
    await service.sendMessage({ agentId: "chief", text: "Keep working" });
    await waitFor(() => service?.listQueue("chief").deliveries.some((delivery) => delivery.status === "failed"));
    expect(service.listQueue("chief").deliveries.at(-1)?.error).toBe(
      "The endpoint this agent used was removed. Choose another model for it.",
    );
  });

  // A removal that fails on disk leaves the endpoint saved and served by the running CLI, so the
  // next removal may still move agents onto it.
  it("keeps an endpoint selectable when its own removal was never written", async () => {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    const { service: agentService, store } = await startService(root, {
      client: (provider) => {
        const client = new FakeAgentClient(provider);
        if (provider === "opencode") {
          client.modelList = () => ({ data: [{ model: "studio/local-llm" }, { model: "house/router-llm" }] });
        }
        return client;
      },
      preferredProvider: "opencode",
    });
    service = agentService;
    await service.ensureProvider("codex");
    await store.getOrCreate("chief");
    await service.updateAgent({ agentId: "chief", provider: "opencode", model: "studio/local-llm" });

    // Removing `studio` moves the agent, and then the file write fails, so `studio` is still an
    // endpoint the user has, and still one the next removal may move agents onto.
    await expect(
      service.removeCustomProvider("studio", () => Promise.reject(new Error("The disk is full."))),
    ).rejects.toThrow("The disk is full.");
    await service.updateAgent({ agentId: "chief", provider: "opencode", model: "studio/local-llm" });

    await service.removeCustomProvider("house", async () => undefined);

    expect(service.listAgents().find((agent) => agent.id === "chief")).toMatchObject({
      provider: "opencode",
      model: "studio/local-llm",
    });
  });

  // The catalogue is what the renderer shows and what `updateAgent` validates against. A removal
  // during a turn skips the restart, so the running CLI keeps listing the endpoint; nothing may offer
  // it after the file that defines it is gone.
  it("hides a removed endpoint's models from the catalogue and from selection", async () => {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    const { service: agentService, store } = await startService(root, {
      client: (provider) => {
        const client = new FakeAgentClient(provider);
        if (provider === "opencode") {
          client.modelList = () => ({ data: [{ model: "studio/local-llm" }, { model: "house/router-llm" }] });
        }
        return client;
      },
      preferredProvider: "opencode",
    });
    service = agentService;
    await store.getOrCreate("chief");
    expect(service.listModels().map((model) => model.id)).toContain("studio/local-llm");

    await service.removeCustomProvider("studio", async () => undefined);

    expect(service.listModels().map((model) => model.id)).not.toContain("studio/local-llm");
    expect(service.listModels().map((model) => model.id)).toContain("house/router-llm");
    await expect(
      service.updateAgent({ agentId: "chief", provider: "opencode", model: "studio/local-llm" }),
    ).rejects.toThrow("The selected agent model is unavailable.");

    // Saved again under the same id, and a fresh process lists it, so both the list and the
    // selection accept it once more.
    await service.reloadOpenCodeConfig();
    await service.updateAgent({ agentId: "chief", provider: "opencode", model: "studio/local-llm" });
    expect(service.listAgents().find((agent) => agent.id === "chief")).toMatchObject({ model: "studio/local-llm" });
  });

  // A removal runs a sweep and then a file write, and an agent update that landed between the two
  // would leave one agent on the endpoint that the removal has already finished with.
  it("refuses a model of an endpoint whose removal is still running", async () => {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    const { service: agentService, store } = await startService(root, {
      client: (provider) => {
        const client = new FakeAgentClient(provider);
        if (provider === "opencode") {
          client.modelList = () => ({ data: [{ model: "studio/local-llm" }, { model: "house/router-llm" }] });
        }
        return client;
      },
      preferredProvider: "opencode",
    });
    service = agentService;
    await store.getOrCreate("chief");
    await service.updateAgent({ agentId: "chief", provider: "opencode", model: "house/router-llm" });

    // The write is held open, so the update below has every chance to run inside the removal.
    const writes: (() => void)[] = [];
    const removal = service.removeCustomProvider(
      "studio",
      () =>
        new Promise<undefined>((resolve) => {
          writes.push(() => resolve(undefined));
        }),
    );
    await waitFor(() => writes.length === 1);
    const selection = service.updateAgent({ agentId: "chief", provider: "opencode", model: "studio/local-llm" });
    writes[0]?.();
    await removal;

    await expect(selection).rejects.toThrow("The selected agent model is unavailable.");
    expect(service.listAgents().find((agent) => agent.id === "chief")).toMatchObject({ model: "house/router-llm" });
  });

  // The same id may name a different server after a second save. While the process that answers on
  // it is the one the save before started, offering the id again would send the next message to the
  // endpoint the user has just replaced.
  it("keeps a replaced endpoint out until a new process reads it", async () => {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    process.env.OPENBOT_CLAUDE_PATH = await createFakeClaude(root);
    const { store, mailbox } = stores(root);
    // Each flag decides whether the *next* process of that CLI starts. OpenCode's says whether the
    // restart works; Claude's keeps Claude unconnected until the test connects it, which is a
    // connect that runs while the OpenCode process stays the one it was.
    let opencodeFailsToStart = false;
    let claudeFailsToStart = true;
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "opencode",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider);
        const start = client.start.bind(client);
        if (provider === "opencode") {
          client.modelList = () => ({ data: [{ model: "studio/local-llm" }, { model: "house/router-llm" }] });
          client.start = () => {
            if (opencodeFailsToStart) throw new Error("OpenCode would not start.");
            start();
          };
        }
        if (provider === "claude") {
          client.start = () => {
            if (claudeFailsToStart) throw new Error("Claude would not start.");
            start();
          };
        }
        return client;
      },
    });
    await service.initialize();
    await store.getOrCreate("chief");

    // The endpoint is removed and saved again under the same id, which may now name another server.
    await service.removeCustomProvider("studio", async () => undefined);

    expect(service.listModels().map((model) => model.id)).not.toContain("studio/local-llm");
    await expect(
      service.updateAgent({ agentId: "chief", provider: "opencode", model: "studio/local-llm" }),
    ).rejects.toThrow("The selected agent model is unavailable.");

    // A restart that fails is reported as a provider status, not as a throw of its own, so what it
    // answers here says nothing about which process answers on the endpoint now.
    opencodeFailsToStart = true;
    await service.reloadOpenCodeConfig().catch(() => undefined);
    // The process from before still answers, which its other model shows, and the removed id is
    // still not among what may be given to an agent.
    expect(service.listModels().map((model) => model.id)).toContain("house/router-llm");
    expect(service.listModels().map((model) => model.id)).not.toContain("studio/local-llm");

    // Connecting another provider starts no new OpenCode process, so it may not give the id back.
    claudeFailsToStart = false;
    await service.ensureProvider("claude");
    expect(service.listModels().map((model) => model.id)).not.toContain("studio/local-llm");

    // A process that started read the endpoint files as they are, and what it lists is the truth.
    opencodeFailsToStart = false;
    await service.reloadOpenCodeConfig();

    expect(service.listModels().map((model) => model.id)).toContain("studio/local-llm");
    await service.updateAgent({ agentId: "chief", provider: "opencode", model: "studio/local-llm" });
    expect(service.listAgents().find((agent) => agent.id === "chief")).toMatchObject({ model: "studio/local-llm" });
  });

  it("keeps an endpoint removed while a process starts out of that process", async () => {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    const { store, mailbox } = stores(root);
    let opencodeClients = 0;
    // Holds the second process at `initialize`, which is the window between the spawn, where the CLI
    // reads the endpoint files, and the catalogue it answers with.
    let signalStarted: () => void = () => undefined;
    let releaseStart: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const held = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "opencode",
      clientFactory: (provider) => {
        if (provider !== "opencode") return new FakeAgentClient(provider);
        opencodeClients += 1;
        const holdThisClient = opencodeClients === 2;
        const client = new FakeAgentClient(provider, undefined, true, true, {}, async (method) => {
          if (method !== "initialize" || !holdThisClient) return;
          signalStarted();
          await held;
        });
        client.modelList = () => ({ data: [{ model: "studio/local-llm" }, { model: "house/router-llm" }] });
        return client;
      },
    });
    await service.initialize();
    await store.getOrCreate("chief");

    // The restart spawns the second process and then waits for it. Its process read the files with
    // the endpoint still on them.
    const restart = service.reloadOpenCodeConfig();
    await started;
    await service.removeCustomProvider("studio", async () => undefined);
    releaseStart();
    expect(await restart).toBe("restarted");

    // The process that arrived says nothing about a removal made after it read the files, so the id
    // stays out and no message can reach the server it named.
    expect(service.listModels().map((model) => model.id)).toContain("house/router-llm");
    expect(service.listModels().map((model) => model.id)).not.toContain("studio/local-llm");
    await expect(
      service.updateAgent({ agentId: "chief", provider: "opencode", model: "studio/local-llm" }),
    ).rejects.toThrow("The selected agent model is unavailable.");

    // A process that spawned after the removal read the files as they are, so its catalogue counts.
    expect(await service.reloadOpenCodeConfig()).toBe("restarted");
    expect(service.listModels().map((model) => model.id)).toContain("studio/local-llm");
  });

  it("keeps an endpoint out while its removal is still being written", async () => {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    const { service: agentService } = await startService(root, {
      client: (provider) => {
        const client = new FakeAgentClient(provider);
        if (provider === "opencode") {
          client.modelList = () => ({ data: [{ model: "studio/local-llm" }, { model: "house/router-llm" }] });
        }
        return client;
      },
      preferredProvider: "opencode",
    });
    service = agentService;

    // The file write is held, so the saved endpoints are still the ones a process spawning now reads.
    let releaseWrite: () => void = () => undefined;
    const written = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const removal = service.removeCustomProvider("studio", () => written);
    // The removal runs on the endpoint chain, so the exclusion arrives on a later tick.
    await waitFor(() => !service?.listModels().some((model) => model.id === "studio/local-llm"));

    // This process reads the file as it still is, so its catalogue does not confirm the removal.
    expect(await service.reloadOpenCodeConfig()).toBe("restarted");
    expect(service.listModels().map((model) => model.id)).toContain("house/router-llm");
    expect(service.listModels().map((model) => model.id)).not.toContain("studio/local-llm");

    releaseWrite();
    await removal;

    // The removal is on disk now, so the next process reads it and its catalogue counts.
    expect(await service.reloadOpenCodeConfig()).toBe("restarted");
    expect(service.listModels().map((model) => model.id)).toContain("studio/local-llm");
  });

  it("fails a delivery whose endpoint is removed while the thread is prepared", async () => {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    // No Codex CLI, so no fallback exists and the removal goes ahead while the agent is busy.
    process.env.OPENBOT_CODEX_PATH = join(root, "absent-codex");
    const { store, mailbox } = stores(root);
    const opencodeMethods: string[] = [];
    let signalPreparing: () => void = () => undefined;
    const preparing = new Promise<void>((resolve) => {
      signalPreparing = resolve;
    });
    let releasePreparing: () => void = () => undefined;
    const prepared = new Promise<void>((resolve) => {
      releasePreparing = resolve;
    });
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "opencode",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider, undefined, true, true, {}, async (method) => {
          if (provider === "opencode") opencodeMethods.push(method);
          // Holds the delivery between the check it passes and the request that starts the turn.
          if (method !== "thread/start") return;
          signalPreparing();
          await prepared;
        });
        if (provider === "opencode") client.modelList = () => ({ data: [{ model: "lmstudio/local-llm" }] });
        return client;
      },
    });
    await service.initialize();
    await store.getOrCreate("chief");
    await service.updateAgent({ agentId: "chief", provider: "opencode", model: "lmstudio/local-llm" });

    await service.sendMessage({ agentId: "chief", text: "Keep working" });
    await preparing;
    await service.removeCustomProvider("lmstudio", async () => undefined);
    releasePreparing();

    await waitFor(() => service?.listQueue("chief").deliveries.some((delivery) => delivery.status === "failed"));
    expect(service.listQueue("chief").deliveries.at(-1)?.error).toBe(
      "The endpoint this agent used was removed. Choose another model for it.",
    );
    // Nothing reached the process that still answers on the removed endpoint.
    expect(opencodeMethods).not.toContain("turn/start");
  });

  it("refuses to steer a message into a turn that runs on a removed endpoint", async () => {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    // No Codex CLI, so no fallback exists and the removal goes ahead while the turn runs.
    process.env.OPENBOT_CODEX_PATH = join(root, "absent-codex");
    const { store, mailbox } = stores(root);
    const clients = new Map<AgentProvider, FakeAgentClient>();
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "opencode",
      clientFactory: (provider) => {
        // The turn stays active, which is the state that holds back the restart of the CLI.
        const client = new FakeAgentClient(provider, "OPENCODE_DONE", false);
        if (provider === "opencode") client.modelList = () => ({ data: [{ model: "lmstudio/local-llm" }] });
        clients.set(provider, client);
        return client;
      },
    });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();
    await store.getOrCreate("chief");
    await service.updateAgent({ agentId: "chief", provider: "opencode", model: "lmstudio/local-llm" });

    await service.sendMessage({ agentId: "chief", text: "Start this turn" });
    await waitFor(() => events.some((event) => event.type === "turn-started"));
    const active = events.find((event) => event.type === "turn-started");
    if (active?.type !== "turn-started") throw new Error("Turn did not start.");
    await service.sendMessage({ agentId: "chief", text: "Add this to the active turn" });
    const queued = service.listQueue("chief").deliveries.find((delivery) => delivery.status === "queued");
    if (!queued) throw new Error("Queued delivery was not created.");

    await service.removeCustomProvider("lmstudio", async () => undefined);

    // The process still holds the session it opened on the removed endpoint, so a steered message
    // would arrive there with the credentials that process started with.
    await expect(
      service.steerQueuedMessage({ agentId: "chief", deliveryId: queued.id, expectedTurnId: active.turnId }),
    ).rejects.toThrow("The endpoint this agent used was removed. Choose another model for it.");
    expect(clients.get("opencode")?.requests.some((request) => request.method === "turn/steer")).toBe(false);
    // The message stays in the queue, so the user can send it again once a model is chosen.
    expect(service.listQueue("chief").deliveries.find((delivery) => delivery.id === queued.id)?.status).toBe("queued");
  });

  it("refuses to steer although the removal already moved the agent to another model", async () => {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    const { store, mailbox } = stores(root);
    const clients = new Map<AgentProvider, FakeAgentClient>();
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "opencode",
      clientFactory: (provider) => {
        // The turn stays active, which is what holds back the restart of the CLI.
        const client = new FakeAgentClient(provider, "OPENCODE_DONE", false);
        if (provider === "opencode") {
          client.modelList = () => ({ data: [{ model: "studio/local-llm" }, { model: "house/router-llm" }] });
        }
        clients.set(provider, client);
        return client;
      },
    });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();
    await store.getOrCreate("chief");
    await service.updateAgent({ agentId: "chief", provider: "opencode", model: "studio/local-llm" });

    await service.sendMessage({ agentId: "chief", text: "Start this turn" });
    await waitFor(() => events.some((event) => event.type === "turn-started"));
    const active = events.find((event) => event.type === "turn-started");
    if (active?.type !== "turn-started") throw new Error("Turn did not start.");
    await service.sendMessage({ agentId: "chief", text: "Add this to the active turn" });
    const queued = service.listQueue("chief").deliveries.find((delivery) => delivery.status === "queued");
    if (!queued) throw new Error("Queued delivery was not created.");

    // The other endpoint is a fallback, so the removal moves the agent record onto it at once.
    await service.removeCustomProvider("studio", async () => undefined);
    expect(service.listAgents().find((agent) => agent.id === "chief")).toMatchObject({ model: "house/router-llm" });

    // The turn the message would join still runs on the session the CLI opened for the removed
    // endpoint, so the model the agent names now says nothing about where the message arrives.
    await expect(
      service.steerQueuedMessage({ agentId: "chief", deliveryId: queued.id, expectedTurnId: active.turnId }),
    ).rejects.toThrow("The endpoint this agent used was removed. Choose another model for it.");
    expect(clients.get("opencode")?.requests.some((request) => request.method === "turn/steer")).toBe(false);
    expect(service.listQueue("chief").deliveries.find((delivery) => delivery.id === queued.id)?.status).toBe("queued");
  });

  it("stops a profile client when the endpoint it may hold is removed", async () => {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    const { store, mailbox } = stores(root);
    const profileClients: FakeAgentClient[] = [];
    // The profile client is a process of its own, so it is the one created while this is true.
    let generating = false;
    let signalProfileStarted: () => void = () => undefined;
    const profileStarted = new Promise<void>((resolve) => {
      signalProfileStarted = resolve;
    });
    let releaseProfile: () => void = () => undefined;
    const profileHeld = new Promise<void>((resolve) => {
      releaseProfile = resolve;
    });
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "opencode",
      clientFactory: (provider) => {
        const profile = generating;
        const client = new FakeAgentClient(provider, undefined, true, true, {}, async () => {
          if (!profile) return;
          signalProfileStarted();
          await profileHeld;
        });
        if (provider === "opencode") {
          client.modelList = () => ({ data: [{ model: "studio/local-llm" }, { model: "house/router-llm" }] });
        }
        if (profile) profileClients.push(client);
        return client;
      },
    });
    await service.initialize();
    await store.getOrCreate("chief");
    await service.updateAgent({ agentId: "chief", provider: "opencode", model: "studio/local-llm" });

    generating = true;
    const generation = service.generateProfile({ prompt: "Describe a research assistant" }, []);
    void generation.catch(() => undefined);
    await profileStarted;
    generating = false;
    const profileClient = profileClients[0];
    if (!profileClient) throw new Error("No profile client was created.");
    expect(profileClient.running).toBe(true);

    await service.removeCustomProvider("studio", async () => undefined);

    // No restart of the main client reaches this process, so it is ended instead.
    expect(profileClient.running).toBe(false);
    // The held request is released so the fake client has nothing left in flight. The generation
    // itself is not awaited: its client is gone, so its result no longer belongs to this test.
    releaseProfile();
  });

  // The models of a removed endpoint must not come back because the replacement said nothing about
  // them. A kept catalogue describes the process that reported it, which is the one already gone.
});
