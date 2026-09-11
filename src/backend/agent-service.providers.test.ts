// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { serializeAttachmentReference } from "@openbot/contracts/attachment-references";
import { serializeChatTagReference } from "@openbot/contracts/chat-tag-references";
import type { AgentEvent } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProvider } from "./agent-client";
import { AgentService } from "./agent-service";
import {
  CREATE_AGENT_INPUT,
  createFakeClaude,
  createFakeGrok,
  createFakeOpencode,
  FakeAgentClient,
  fakeBrowser,
  firstInputText,
  notification,
  paramsRecord,
  protocolMessages,
  startAgentTestFixture,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "./agent-service-test-harness";
import type { DynamicToolCallParams } from "./protocol";
import { SidebarLayoutStore } from "./sidebar-layout-store";

let root: string;
let logPath: string;
let service: AgentService | null = null;

beforeEach(async () => {
  ({ root, logPath } = await startAgentTestFixture());
});

afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

describe.sequential("AgentService: providers", () => {
  it("runs a channel turn in a separate session and returns to the unchanged normal conversation", async () => {
    const { store, mailbox } = stores(root);
    const client = new FakeAgentClient("codex", "CODEX_DONE");
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", () => client);
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "This is my normal conversation." });
    await waitFor(() => service?.listQueue("chief").deliveries.every((delivery) => delivery.status === "completed"));
    const agent = service.listAgents().find((item) => item.id === "chief");
    if (!agent?.threadId) throw new Error("Normal conversation did not start.");
    const normalSession = store.activeProviderSession(agent.id)?.externalSessionId;
    const before = await service.readConversation(agent.id);
    const actor = { id: "human", name: "Alex" };
    await service.channels.command(
      {
        type: "save",
        channelId: "channel-1",
        operationId: "create",
        draft: {
          name: "Project",
          title: "",
          instructions: "Shared work",
          members: [{ agentId: agent.id }],
          leadAgentId: agent.id,
        },
      },
      actor,
    );
    await service.channels.command(
      {
        type: "send",
        channelId: "channel-1",
        operationId: "send",
        text: "Work only in this channel.",
        recipientAgentId: agent.id,
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      actor,
    );
    await waitFor(() => service?.channels.store.tasks("channel-1")[0]?.state === "completed");
    expect(
      service.channels.store
        .messages("channel-1")
        .filter((item) => item.author.kind === "agent")
        .map((item) => item.message.text),
    ).toEqual(["CODEX_DONE"]);
    expect((await service.readConversation(agent.id)).messages).toEqual(before.messages);
    expect(store.activeProviderSession(agent.id)?.externalSessionId).toBe(normalSession);
    expect(store.list().find((item) => item.id === agent.id)?.threadId).toBe(agent.threadId);
    const execution = service.channels.store.context("channel-1", agent.id);
    expect(store.database.activeProviderSession(execution.threadId, agent.provider)?.externalSessionId).not.toBe(
      normalSession,
    );
    await service.sendMessage({ agentId: agent.id, text: "Continue in the normal conversation." });
    await waitFor(() => service?.listQueue(agent.id).deliveries.every((delivery) => delivery.status === "completed"));
    expect(store.activeProviderSession(agent.id)?.externalSessionId).toBe(normalSession);
  });

  it("resumes a channel session after the profile or the memories of the agent change", async () => {
    const { store, mailbox } = stores(root);
    const client = new FakeAgentClient("codex", "CODEX_DONE");
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", () => client);
    await service.initialize();
    await store.getOrCreate("chief");
    const actor = { id: "human", name: "Alex" };
    await service.channels.command(
      {
        type: "save",
        channelId: "channel-1",
        operationId: "create",
        draft: {
          name: "Project",
          title: "",
          instructions: "Shared work",
          members: [{ agentId: "chief" }],
          leadAgentId: "chief",
        },
      },
      actor,
    );
    const ask = async (operationId: string, text: string, tasks: number): Promise<void> => {
      await service?.channels.command(
        {
          type: "send",
          channelId: "channel-1",
          operationId,
          text,
          recipientAgentId: "chief",
          replyToMessageId: null,
          attachmentDraftIds: [],
        },
        actor,
      );
      // The count is part of the wait: the request of this ask has to reach the channel before the
      // tasks of the ask before it can answer for it.
      await waitFor(() => {
        const open = service?.channels.store.tasks("channel-1") ?? [];
        return open.length === tasks && open.every((task) => task.state === "completed");
      });
    };
    await ask("first", "Start the shared work.", 1);
    const execution = service.channels.store.context("channel-1", "chief");
    const channelSession = store.database.activeProviderSession(execution.threadId, "codex")?.externalSessionId;
    if (!channelSession) throw new Error("The channel turn started no provider session.");
    const lastChannelResume = (): string =>
      JSON.stringify(
        client.requests
          .filter((request) => request.method === "thread/resume")
          .filter((request) => paramsRecord(request.params)?.threadId === channelSession)
          .at(-1)?.params ?? "no resume of the channel session",
      );

    // The developer instructions are written when the session loads, so a memory the agent saved
    // after that reaches the channel only when the next turn loads the session again.
    service.createMemory({ agentId: "chief", text: "The user prefers concise status updates." });
    await ask("second", "Continue the shared work.", 2);
    expect(lastChannelResume()).toContain("The user prefers concise status updates.");

    await service.updateAgent({ agentId: "chief", description: "Owns the quarterly report." });
    await ask("third", "Report on the shared work.", 3);
    expect(lastChannelResume()).toContain("Owns the quarterly report.");

    // The profile dialog saves through a second path, which holds the same standing instructions.
    const sidebar = new SidebarLayoutStore(join(root, "sidebar.json"));
    await sidebar.initialize();
    await service.saveProfile(
      {
        operationId: randomUUID(),
        agentId: "chief",
        draft: {
          name: "Chief",
          title: "Local teammate",
          description: "Runs the weekly review.",
          avatarSeed: "first-bot",
          avatarHue: null,
          sectionId: null,
        },
      },
      sidebar,
    );
    await ask("fourth", "Review the shared work.", 4);
    expect(lastChannelResume()).toContain("Runs the weekly review.");
  });

  it("keeps an agent with active channel work from being deleted", async () => {
    const { store, mailbox } = stores(root);
    const client = new FakeAgentClient("codex", "", false);
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", () => client);
    await service.initialize();
    await store.getOrCreate("chief");
    await service.channels.command(
      {
        type: "save",
        channelId: "channel-busy",
        operationId: "create-busy",
        draft: {
          name: "Project",
          title: "",
          instructions: "Shared work",
          members: [{ agentId: "chief" }],
          leadAgentId: "chief",
        },
      },
      { id: "human", name: "Alex" },
    );
    await service.channels.command(
      {
        type: "send",
        channelId: "channel-busy",
        operationId: "send-busy",
        text: "Continue working",
        recipientAgentId: "chief",
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      { id: "human", name: "Alex" },
    );
    await waitFor(() => service?.channels.store.tasks("channel-busy")[0]?.state === "running");
    expect(service.listQueue("chief").deliveries).toEqual([]);
    await expect(service.deleteAgent("chief")).rejects.toThrow("Stop the agent");
    expect(service.listAgents().some((agent) => agent.id === "chief")).toBe(true);
  });

  it("refreshes outdated Codex tools while preserving the agent and conversation, then resumes unchanged tools", async () => {
    const { store, mailbox } = stores(root);
    let rejectTurn = false;
    const client = new FakeAgentClient("codex", "CODEX_DONE", true, true, {}, async (method) => {
      if (method === "turn/start" && rejectTurn) throw new Error("Provider rejected the handoff turn.");
    });
    const startService = async () => {
      const next = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", () => client);
      await next.initialize();
      return next;
    };
    service = await startService();
    await service.sendMessage({ agentId: "chief", text: "Remember that my researchers cover tennis and football." });
    await waitFor(() => service?.listQueue("chief").deliveries.every((delivery) => delivery.status === "completed"));
    const original = service.listAgents().find((agent) => agent.id === "chief");
    const originalSession = store.activeProviderSession("chief")?.externalSessionId;
    if (!original || !originalSession) throw new Error("The original session did not start.");
    await service.stop();
    const directory = join(store.database.userDataPath, "provider-toolsets");
    const [manifest] = await readdir(directory);
    if (!manifest) throw new Error("The session tool manifest was not saved.");
    await writeFile(join(directory, manifest), "old-toolset");

    rejectTurn = true;
    service = await startService();
    await service.sendMessage({ agentId: "chief", text: "Group my researchers." });
    await waitFor(() => service?.listQueue("chief").deliveries.some((delivery) => delivery.status === "failed"));
    await service.stop();
    rejectTurn = false;
    service = await startService();
    await service.sendMessage({ agentId: "chief", text: "Try grouping them again." });
    await waitFor(() =>
      service?.listQueue("chief").deliveries.every((delivery) => ["completed", "failed"].includes(delivery.status)),
    );
    const replacement = store.activeProviderSession("chief")?.externalSessionId;
    expect(replacement).not.toBe(originalSession);
    expect(service.listAgents().find((agent) => agent.id === "chief")).toMatchObject({
      id: original.id,
      threadId: original.threadId,
      workspacePath: original.workspacePath,
    });
    expect(
      (await service.readConversation("chief")).messages.some((message) =>
        message.text.includes("tennis and football"),
      ),
    ).toBe(true);
    const starts = client.requests.filter((request) => request.method === "thread/start");
    expect(starts).toHaveLength(2);
    expect(paramsRecord(starts[1]?.params)?.dynamicTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "openbot",
          tools: expect.arrayContaining([expect.objectContaining({ name: "create_section" })]),
        }),
      ]),
    );
    const turns = client.requests.filter((request) => request.method === "turn/start");
    expect(JSON.stringify(turns.at(-1)?.params)).toContain("tennis and football");
    await service.stop();

    service = await startService();
    await service.sendMessage({ agentId: "chief", text: "Continue." });
    await waitFor(() =>
      service?.listQueue("chief").deliveries.every((delivery) => ["completed", "failed"].includes(delivery.status)),
    );
    expect(store.activeProviderSession("chief")?.externalSessionId).toBe(replacement);
    expect(client.requests.filter((request) => request.method === "thread/start")).toHaveLength(2);
  });

  it("deletes unloaded pending handoffs for active and retired sessions with their agent", async () => {
    const { store, mailbox } = stores(root);
    let rejectTurn = false;
    const client = new FakeAgentClient("codex", "DONE", true, true, {}, async (method) => {
      if (rejectTurn && method === "turn/start") throw new Error("Turn rejected.");
    });
    const start = async () => {
      const next = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", () => client);
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
    const { store, mailbox } = stores(root);
    const client = new FakeAgentClient("codex");
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", () => client);
    await service.initialize();
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
        service = new AgentService(store, mailbox, fakeBrowser(), 30_000, provider, (selectedProvider) => {
          const client = new FakeAgentClient(selectedProvider);
          clients.set(selectedProvider, client);
          return client;
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
        expect(instructions).toContain("explicitly send the result back");
        expect(instructions).toContain("Do not create acknowledgement loops");
        expect(instructions).not.toContain("When you receive a reply, summarize it for the user");
        await service.stop();
      }
    },
  );

  it("moves an agent off a removed endpoint onto a model OpenCode still lists", async () => {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "opencode", (provider) => {
      const client = new FakeAgentClient(provider);
      // OpenCode reports a custom endpoint's model as `<endpoint id>/<model id>`, beside its own.
      if (provider === "opencode") {
        client.modelList = () => ({ data: [{ model: "opencode/example-model" }, { model: "lmstudio/local-llm" }] });
      }
      return client;
    });
    await service.initialize();
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
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "opencode", (provider) => {
      const client = new FakeAgentClient(provider);
      // Two endpoints and no OpenCode model of its own, so the fallback for one removal is the other
      // endpoint, and the fallback for the second removal must leave OpenCode altogether.
      if (provider === "opencode") {
        client.modelList = () => ({ data: [{ model: "studio/local-llm" }, { model: "house/router-llm" }] });
      }
      return client;
    });
    await service.initialize();
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
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "opencode", (provider) => {
      const client = new FakeAgentClient(provider);
      // Every OpenCode model belongs to the endpoint being removed, so there is nothing to move to.
      if (provider === "opencode") client.modelList = () => ({ data: [{ model: "lmstudio/local-llm" }] });
      return client;
    });
    await service.initialize();
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
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "opencode", (provider) => {
      const client = new FakeAgentClient(provider);
      if (provider === "opencode") {
        client.modelList = () => ({ data: [{ model: "studio/local-llm" }, { model: "house/router-llm" }] });
      }
      return client;
    });
    await service.initialize();
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
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "opencode", (provider) => {
      const client = new FakeAgentClient(provider);
      if (provider === "opencode") {
        client.modelList = () => ({ data: [{ model: "studio/local-llm" }, { model: "house/router-llm" }] });
      }
      return client;
    });
    await service.initialize();
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
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "opencode", (provider) => {
      const client = new FakeAgentClient(provider);
      if (provider === "opencode") {
        client.modelList = () => ({ data: [{ model: "studio/local-llm" }, { model: "house/router-llm" }] });
      }
      return client;
    });
    await service.initialize();
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
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "opencode", (provider) => {
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
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "opencode", (provider) => {
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
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "opencode", (provider) => {
      const client = new FakeAgentClient(provider);
      if (provider === "opencode") {
        client.modelList = () => ({ data: [{ model: "studio/local-llm" }, { model: "house/router-llm" }] });
      }
      return client;
    });
    await service.initialize();

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
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "opencode", (provider) => {
      const client = new FakeAgentClient(provider, undefined, true, true, {}, async (method) => {
        if (provider === "opencode") opencodeMethods.push(method);
        // Holds the delivery between the check it passes and the request that starts the turn.
        if (method !== "thread/start") return;
        signalPreparing();
        await prepared;
      });
      if (provider === "opencode") client.modelList = () => ({ data: [{ model: "lmstudio/local-llm" }] });
      return client;
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
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "opencode", (provider) => {
      // The turn stays active, which is the state that holds back the restart of the CLI.
      const client = new FakeAgentClient(provider, "OPENCODE_DONE", false);
      if (provider === "opencode") client.modelList = () => ({ data: [{ model: "lmstudio/local-llm" }] });
      clients.set(provider, client);
      return client;
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
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "opencode", (provider) => {
      // The turn stays active, which is what holds back the restart of the CLI.
      const client = new FakeAgentClient(provider, "OPENCODE_DONE", false);
      if (provider === "opencode") {
        client.modelList = () => ({ data: [{ model: "studio/local-llm" }, { model: "house/router-llm" }] });
      }
      clients.set(provider, client);
      return client;
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
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "opencode", (provider) => {
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
  it("keeps a removed endpoint out when the replacement cannot list its models", async () => {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    const { store, mailbox } = stores(root);
    let opencodeClients = 0;
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "opencode", (provider) => {
      const client = new FakeAgentClient(provider);
      if (provider === "opencode") {
        opencodeClients += 1;
        const failsDiscovery = opencodeClients === 2;
        client.modelList = () => {
          if (failsDiscovery) throw new Error("Model discovery failed.");
          return { data: [{ model: "studio/local-llm" }, { model: "house/router-llm" }] };
        };
      }
      return client;
    });
    await service.initialize();
    await store.getOrCreate("chief");
    await service.updateAgent({ agentId: "chief", provider: "opencode", model: "house/router-llm" });

    await service.removeCustomProvider("studio", async () => undefined);
    await service.reloadOpenCodeConfig();

    expect(service.listModels().some((model) => model.id === "studio/local-llm")).toBe(false);
  });

  // An id this app never saved can already exist in OpenCode's own configuration. Until a process
  // that read the save answers, those models belong to the old URL, not to the endpoint just saved.
  it("keeps a saved id out until a process that read the save answers", async () => {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "opencode", (provider) => {
      const client = new FakeAgentClient(provider);
      if (provider === "opencode") {
        client.modelList = () => ({ data: [{ model: "studio/local-llm" }, { model: "house/router-llm" }] });
      }
      return client;
    });
    await service.initialize();
    await store.getOrCreate("chief");
    await service.updateAgent({ agentId: "chief", provider: "opencode", model: "house/router-llm" });

    await service.saveCustomProvider("studio", async () => undefined);

    expect(service.listModels().some((model) => model.id === "studio/local-llm")).toBe(false);

    await service.reloadOpenCodeConfig();

    expect(service.listModels().some((model) => model.id === "studio/local-llm")).toBe(true);
  });

  // An id saved again is served again, whatever the CLI did with the removal before it.
  it("offers an endpoint's models again after the id is saved a second time", async () => {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "opencode", (provider) => {
      const client = new FakeAgentClient(provider);
      if (provider === "opencode") {
        client.modelList = () => ({ data: [{ model: "studio/local-llm" }, { model: "house/router-llm" }] });
      }
      return client;
    });
    await service.initialize();
    await service.ensureProvider("codex");
    await store.getOrCreate("chief");
    await service.updateAgent({ agentId: "chief", provider: "opencode", model: "house/router-llm" });

    await service.removeCustomProvider("studio", async () => undefined);
    await service.reloadOpenCodeConfig();

    await service.removeCustomProvider("house", async () => undefined);

    expect(service.listAgents().find((agent) => agent.id === "chief")).toMatchObject({
      provider: "opencode",
      model: "studio/local-llm",
    });
  });

  it("refuses to release a busy agent when the only model left belongs to another provider", async () => {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    const { store, mailbox } = stores(root);
    const clients = new Map<AgentProvider, FakeAgentClient>();
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "opencode", (provider) => {
      // The turn never finishes, so the agent stays busy for the whole test.
      const client = new FakeAgentClient(provider, "", false);
      // Every OpenCode model comes from the endpoint being removed, so the fallback has to change
      // provider, and that is the switch which must not happen under a running turn.
      if (provider === "opencode") client.modelList = () => ({ data: [{ model: "lmstudio/local-llm" }] });
      clients.set(provider, client);
      return client;
    });
    await service.initialize();
    await service.ensureProvider("codex");
    await store.getOrCreate("chief");
    await service.updateAgent({ agentId: "chief", provider: "opencode", model: "lmstudio/local-llm" });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.sendMessage({ agentId: "chief", text: "Keep working" });
    await waitFor(() => events.some((event) => event.type === "turn-started"));

    await expect(service.removeCustomProvider("lmstudio", async () => undefined)).rejects.toThrow(
      "Wait for the active turn and queue to finish before you remove this endpoint.",
    );

    // The endpoint stays saved because the caller stops on the refusal, so the agent must still name
    // its model: a switch here would leave the running OpenCode process unowned and stoppable.
    expect(service.listAgents().find((agent) => agent.id === "chief")).toMatchObject({
      provider: "opencode",
      model: "lmstudio/local-llm",
    });
  });

  it("derives live progress from the provider-neutral turn and tool lifecycle", async () => {
    const clients = new Map<AgentProvider, FakeAgentClient>();
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", (provider) => {
      const client = new FakeAgentClient(provider, "", false);
      clients.set(provider, client);
      return client;
    });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "Check the latest result" });
    await waitFor(() => events.some((event) => event.type === "turn-started"));
    const started = events.find((event) => event.type === "turn-started");
    const client = clients.get("codex");
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    if (started?.type !== "turn-started" || !client || !threadId) {
      throw new Error("The fake provider turn did not start.");
    }
    const turnId = started.turnId;

    const progress = () =>
      events.filter(
        (event): event is Extract<AgentEvent, { type: "turn-progress" }> =>
          event.type === "turn-progress" && event.turnId === turnId,
      );
    expect(progress()).toEqual([]);
    const stored = await service.readConversation("chief");
    expect(stored.messages.find((message) => message.id === `activity:${turnId}`)).toBeUndefined();
    client.emit(
      "notification",
      notification("item/started", {
        threadId,
        turnId,
        item: { id: "reasoning-1", type: "reasoning", summary: [], content: [] },
      }),
    );
    client.emit(
      "notification",
      notification("item/reasoning/summaryTextDelta", {
        threadId,
        turnId,
        itemId: "reasoning-1",
        summaryIndex: 0,
        delta: "Inspecting the sources.",
      }),
    );
    client.emit(
      "notification",
      notification("item/reasoning/summaryPartAdded", {
        threadId,
        turnId,
        itemId: "reasoning-1",
        summaryIndex: 1,
      }),
    );
    client.emit(
      "notification",
      notification("item/reasoning/summaryTextDelta", {
        threadId,
        turnId,
        itemId: "reasoning-1",
        summaryIndex: 1,
        delta: "Comparing the results.",
      }),
    );
    const reasoning = (await service.readConversation("chief")).messages.find(
      (message) => message.id === "reasoning-1",
    );
    expect(reasoning).toMatchObject({
      itemType: "commentary",
      status: "streaming",
      text: "Inspecting the sources.\n\nComparing the results.",
    });
    client.emit(
      "notification",
      notification("item/completed", {
        threadId,
        turnId,
        item: {
          id: "reasoning-1",
          type: "reasoning",
          summary: ["Inspecting the sources.", "Comparing the results."],
          content: [],
        },
      }),
    );
    expect(
      (await service.readConversation("chief")).messages.find((message) => message.id === "reasoning-1"),
    ).toMatchObject({
      itemType: "commentary",
      status: "completed",
      text: reasoning?.text,
    });
    const conversationEventCount = () => events.filter((event) => event.type === "conversation").length;
    const persistedBeforeTools = conversationEventCount();

    client.emit(
      "notification",
      notification("item/started", {
        threadId,
        turnId,
        item: { id: "tool-1", type: "toolCall", name: "web_search", status: "in_progress" },
      }),
    );
    await waitFor(() => progress().at(-1)?.detail === "Searching for current information…");

    client.emit(
      "notification",
      notification("item/completed", {
        threadId,
        turnId,
        item: { id: "tool-1", type: "toolCall", name: "web_search", status: "completed" },
      }),
    );
    await waitFor(() => progress().at(-1)?.detail === "Reviewing the sources and information I found…");
    expect(conversationEventCount()).toBe(persistedBeforeTools);

    client.emit(
      "notification",
      notification("item/completed", {
        threadId,
        turnId,
        item: { id: "answer-1", type: "agentMessage", text: "Here is the result." },
      }),
    );
    client.emit(
      "notification",
      notification("turn/completed", { threadId, turn: { id: turnId, status: "completed" } }),
    );
    await waitFor(() => events.some((event) => event.type === "turn-completed" && event.turnId === turnId));
  });

  it("creates a bounded runtime snapshot for reconnecting clients", async () => {
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser());
    await service.initialize();
    await store.getOrCreate("chief");

    expect(service.getRuntimeSnapshot()).toMatchObject({
      agents: [expect.objectContaining({ id: "chief" })],
      activeTurns: [],
      work: [],
      attentionComplete: true,
      pendingPrompts: [],
      pendingApprovals: [],
      pendingBrowserTakeovers: [],
      failedTurns: [],
    });
    expect(service.getRuntimeSnapshot().agents[0]).not.toHaveProperty("workspacePath");
    expect(service.getRuntimeSnapshot().agents[0]).not.toHaveProperty("description");
  });

  it("resolves only regular files inside the shared directory", async () => {
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser());
    await service.initialize();

    const nested = join(store.sharedRoot, "nested");
    const sharedFile = join(nested, "report.csv");
    const outside = join(root, "outside.csv");
    const link = join(nested, "outside-link.csv");
    await mkdir(nested, { recursive: true });
    await writeFile(sharedFile, "value\n");
    await writeFile(outside, "secret\n");
    await symlink(outside, link);

    await expect(service.resolveSharedFile("~/OpenBot/Shared/nested/report.csv")).resolves.toMatchObject({
      path: await realpath(sharedFile),
      name: "report.csv",
      size: 6,
    });
    await expect(service.resolveSharedFile(outside)).rejects.toThrow("inside the shared directory");
    await expect(service.resolveSharedFile(link)).rejects.toThrow("inside the shared directory");
  });

  it("opens a historical routine message that only exists in the mailbox", async () => {
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser());
    await service.initialize();
    await store.getOrCreate("chief");
    await store.ensureThreadId("chief");
    const receipt = await mailbox.enqueue({
      sender: {
        kind: "routine",
        routineId: "routine-1",
        runId: "run-1",
        routineName: "Morning brief",
        scheduledFor: "2026-08-25T07:00:00.000Z",
      },
      recipientAgentIds: ["chief"],
      text: "Prepare the morning brief.",
      idempotencyKey: "test:routine-history:run-1",
    });
    const messageId = receipt.deliveries[0]?.id;
    if (!messageId) throw new Error("The routine delivery was not created.");

    const page = await service.readConversationPageFor("chief", "member-1", { type: "around", messageId }, 50);

    expect(page.messages).toContainEqual(
      expect.objectContaining({
        id: messageId,
        source: "routine",
        routine: expect.objectContaining({ routineId: "routine-1", runId: "run-1" }),
      }),
    );
  });

  it("resolves only regular files inside the selected agent workspace", async () => {
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser());
    await service.initialize();

    const agent = await store.createAgent(CREATE_AGENT_INPUT);
    const appDirectory = join(agent.workspacePath, "app");
    const page = join(appDirectory, "page.tsx");
    const spaced = join(agent.workspacePath, "lutra brand board.html");
    const outside = join(root, "outside.html");
    const link = join(appDirectory, "outside-link.html");
    await mkdir(appDirectory, { recursive: true });
    await writeFile(page, "export default function Page() {}\n");
    await writeFile(spaced, "<!doctype html>\n");
    await writeFile(outside, "secret\n");
    await symlink(outside, link);

    await expect(service.resolveWorkspaceFile(agent.id, "app/page.tsx")).resolves.toMatchObject({
      path: await realpath(page),
      name: "page.tsx",
    });
    await expect(service.resolveWorkspaceFile(agent.id, page)).resolves.toMatchObject({
      path: await realpath(page),
      name: "page.tsx",
    });
    await expect(service.resolveWorkspaceFile(agent.id, "lutra%20brand%20board.html")).resolves.toMatchObject({
      path: await realpath(spaced),
      name: "lutra brand board.html",
    });
    await expect(service.resolveWorkspaceFile(agent.id, outside)).rejects.toThrow("inside the agent workspace");
    await expect(service.resolveWorkspaceFile(agent.id, link)).rejects.toThrow("inside the agent workspace");
    await expect(service.resolveWorkspaceFile("missing", page)).rejects.toThrow("Unknown agent");
  });

  it("does not surface the skills context-budget notice as an agent error", async () => {
    process.env.OPENBOT_FAKE_WARNING = "Skill descriptions were shortened to fit the skills context budget.";
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser());
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();

    await service.sendMessage({ agentId: "chief", text: "First task" });
    await waitFor(() => events.some((event) => event.type === "turn-started"));

    expect(events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "error",
          message: expect.stringContaining("Skill descriptions were shortened"),
        }),
      ]),
    );
  });

  it("expands inline file references before sending text to the agent", async () => {
    const source = join(root, "start-types.d.ts");
    await writeFile(source, "export type Start = true;\n");
    const clients = new Map<AgentProvider, FakeAgentClient>();
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", (provider) => {
      const client = new FakeAgentClient(provider);
      clients.set(provider, client);
      return client;
    });
    await service.initialize();
    const [draft] = await service.prepareAttachments([source]);

    await service.sendMessage({
      agentId: "chief",
      text: `Review ${serializeAttachmentReference(draft.name, draft.id)}`,
      attachmentDraftIds: [draft.id],
    });
    await waitFor(() => Boolean(clients.get("codex")?.requests.some((request) => request.method === "turn/start")));

    const turn = clients.get("codex")?.requests.find((request) => request.method === "turn/start");
    const inputText = firstInputText(turn?.params);
    expect(inputText).toContain("Review start-types.d.ts");
    expect(inputText).not.toContain("attachment:");
  });

  it("expands agent and skill tags before sending text to the agent", async () => {
    const clients = new Map<AgentProvider, FakeAgentClient>();
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", (provider) => {
      const client = new FakeAgentClient(provider);
      clients.set(provider, client);
      return client;
    });
    await service.initialize();
    await store.getOrCreate("research", "Research Lead", "Research partner");

    await service.sendMessage({
      agentId: "chief",
      text: `Ask ${serializeChatTagReference("agent", "Old Research", "research")} to use ${serializeChatTagReference("skill", "Release Notes", "skill-1")}.`,
    });
    await waitFor(() => Boolean(clients.get("codex")?.requests.some((request) => request.method === "turn/start")));

    const turn = clients.get("codex")?.requests.find((request) => request.method === "turn/start");
    expect(firstInputText(turn?.params)).toContain("Ask @Research Lead to use Release Notes (skill).");
    expect(firstInputText(turn?.params)).not.toContain("Old Research");
  });

  it("creates independent full-access threads with browser and OpenBot tools", async () => {
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser());
    await service.initialize();

    expect(service.getStatus()).toMatchObject({
      phase: "ready",
      auth: { kind: "chatgpt", email: "codex@example.com" },
      providers: [
        {
          id: "codex",
          state: "available",
          version: "0.144.1",
          email: "codex@example.com",
        },
        { id: "claude", state: "error", version: null },
        { id: "grok", state: "not-installed", version: null },
        { id: "opencode", state: "not-installed", version: null },
      ],
      capabilities: { chat: "ready", browser: "ready", computerUse: "ready" },
    });
    await expect(service.getUsage()).resolves.toMatchObject({
      limits: [
        {
          id: "codex",
          primary: { usedPercent: 25, windowDurationMins: 300 },
          secondary: { usedPercent: 40, windowDurationMins: 10_080 },
        },
      ],
    });
    await service.sendMessage({ agentId: "chief", text: "First task" });
    await service.sendMessage({ agentId: "sales-outbound", text: "Second task" });
    await waitFor(
      async () => (await protocolMessages(logPath)).filter((item) => item.method === "turn/start").length === 2,
    );

    const requests = await protocolMessages(logPath);
    const starts = requests.filter((message) => message.method === "thread/start");
    expect(starts).toHaveLength(2);
    for (const start of starts) {
      const params = paramsRecord(start.params);
      if (!params) throw new Error("The fake thread request has no parameters.");
      expect(params).toMatchObject({
        model: "gpt-5.6-luna",
        approvalPolicy: "on-request",
        sandbox: "danger-full-access",
        ephemeral: false,
        serviceName: "openbot",
      });
      expect(params.runtimeWorkspaceRoots).toEqual([params.cwd, store.sharedRoot]);
      expect(params.developerInstructions).toContain(
        "You have full local computer, filesystem, command, and network access",
      );
      expect(params.developerInstructions).toContain(
        "You may list, read, create, edit, move, and delete files and run local commands in both directories.",
      );
      expect(params.developerInstructions).toContain("For every browser task");
      expect(params.developerInstructions).toContain("Use the installed Computer Use plugin only");
      expect(params.developerInstructions).toContain("When you use openbot_browser");
      expect(params.developerInstructions).toContain("openbot.create_routine");
      expect(params.developerInstructions).toContain("Never use ChatGPT Sites");
      expect(params.developerInstructions).toContain("openbot.attach_files_to_response");
      expect(params.developerInstructions).toContain("sadness, disappointment, frustration, loneliness");
      expect(params.developerInstructions).toContain("An emoji written inside your answer does not count");
      expect(params.developerInstructions).toContain("Omit agentId to target yourself");
      expect.soft(params.developerInstructions).toContain("call openbot.list_agents and openbot.list_sections");
      expect.soft(params.developerInstructions).toContain("Prefer suitable agents in your own section first");
      expect
        .soft(params.developerInstructions)
        .toContain(
          "Choose agents outside it when no suitable section member is available or additional expertise is needed; you do not need to contact a section member first.",
        );
      expect
        .soft(params.developerInstructions)
        .toContain(
          "If you have no section, choose by name, title, and description without giving other ungrouped agents priority.",
        );
      expect
        .soft(params.developerInstructions)
        .toContain(
          "Recipients explicitly named by the user and replies to existing messages take priority over section preference.",
        );
      expect(params.dynamicTools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "namespace", name: "openbot_browser" }),
          expect.objectContaining({
            type: "namespace",
            name: "openbot",
            tools: expect.arrayContaining([
              expect.objectContaining({ name: "attach_files_to_response" }),
              expect.objectContaining({ name: "ask_user" }),
              expect.objectContaining({ name: "list_agents" }),
              expect.objectContaining({ name: "update_profile" }),
              expect.objectContaining({ name: "create_agent" }),
              expect.objectContaining({ name: "list_sections" }),
              expect.objectContaining({ name: "create_section" }),
              expect.objectContaining({ name: "rename_section" }),
              expect.objectContaining({ name: "delete_section" }),
              expect.objectContaining({ name: "assign_agent_section" }),

              expect.objectContaining({ name: "list_routines" }),
              expect.objectContaining({ name: "create_routine" }),
              expect.objectContaining({ name: "update_routine" }),
              expect.objectContaining({ name: "delete_routine" }),
              expect.objectContaining({ name: "test_routine" }),
              expect.objectContaining({ name: "react_to_user_message" }),
            ]),
          }),
        ]),
      );
      const browserTools = (Array.isArray(params.dynamicTools) ? params.dynamicTools : [])
        .filter(isDynamicRecord)
        .find((tool) => tool.type === "namespace" && tool.name === "openbot_browser");
      expect(browserTools).toMatchObject({
        tools: expect.arrayContaining([expect.objectContaining({ name: "request_takeover" })]),
      });
    }
    for (const turn of requests.filter((message) => message.method === "turn/start")) {
      const params = paramsRecord(turn.params);
      if (!params) throw new Error("The fake turn request has no parameters.");
      expect(params).toMatchObject({
        model: "gpt-5.6-luna",
        effort: "medium",
        approvalPolicy: "on-request",
        sandboxPolicy: { type: "dangerFullAccess" },
      });
      expect(params.runtimeWorkspaceRoots).toEqual([params.cwd, store.sharedRoot]);
    }
    expect((await store.getOrCreate("chief")).threadId).not.toBe((await store.getOrCreate("sales-outbound")).threadId);
  });

  it("reads usage for the selected agent provider and prefers its model-specific bucket", async () => {
    process.env.OPENBOT_CLAUDE_PATH = await createFakeClaude(root);
    const clients = new Map<AgentProvider, FakeAgentClient>();
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, fakeBrowser(), 30_000, "codex", (provider) => {
      const client = new FakeAgentClient(provider);
      clients.set(provider, client);
      return client;
    });
    await service.initialize();
    await store.getOrCreate("chief");
    await service.updateAgent({ agentId: "chief", provider: "codex", model: "gpt-5.6-luna" });
    const codex = clients.get("codex");
    if (!codex) throw new Error("Codex test client was not created.");
    codex.accountRateLimits = {
      rateLimits: {
        limitId: "codex",
        secondary: { usedPercent: 40, windowDurationMins: 10_080, resetsAt: 1_787_040_000 },
      },
      rateLimitsByLimitId: {
        luna: {
          limitId: "luna",
          limitName: "gpt-5.6-luna",
          secondary: { usedPercent: 70, windowDurationMins: 10_080, resetsAt: 1_787_040_000 },
        },
      },
    };

    await expect(service.getUsage("chief")).resolves.toMatchObject({
      limits: [{ id: "luna", secondary: { usedPercent: 70 } }],
    });

    await service.updateAgent({ agentId: "chief", provider: "codex", model: "gpt-5.6-sol" });
    await expect(service.getUsage("chief")).resolves.toMatchObject({
      limits: [{ id: "codex", secondary: { usedPercent: 40 } }],
    });

    await service.updateAgent({ agentId: "chief", provider: "claude", model: "claude-sonnet-5" });
    const claude = clients.get("claude");
    if (!claude) throw new Error("Claude test client was not created.");
    claude.accountRateLimits = {
      rateLimits: {
        limitId: "claude",
        secondary: { usedPercent: 55, windowDurationMins: 10_080, resetsAt: 1_787_040_000 },
      },
      rateLimitsByLimitId: null,
    };

    await expect(service.getUsage("chief")).resolves.toMatchObject({
      limits: [{ id: "claude", secondary: { usedPercent: 55 } }],
    });
    expect(claude.requests).toContainEqual({
      method: "account/rateLimits/read",
      params: { model: "claude-sonnet-5" },
    });
  });

  it("maps provider browser tool calls to the stable OpenBot thread", async () => {
    const calls: DynamicToolCallParams[] = [];
    const browser = fakeBrowser();
    browser.handleDynamicTool = async (params) => {
      calls.push(params);
      return { success: true, contentItems: [] };
    };
    const clients = new Map<AgentProvider, FakeAgentClient>();
    const { store, mailbox } = stores(root);
    service = new AgentService(store, mailbox, browser, 30_000, "codex", (provider) => {
      const client = new FakeAgentClient(provider);
      clients.set(provider, client);
      return client;
    });
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "Browse" });
    await waitFor(() => Boolean(store.activeProviderSession("chief")));

    const providerThreadId = store.activeProviderSession("chief")?.externalSessionId;
    const openbotThreadId = (await store.getOrCreate("chief")).threadId;
    const client = clients.get("codex");
    if (!providerThreadId || !openbotThreadId || !client) throw new Error("Browser test thread was not created.");
    expect(providerThreadId).not.toBe(openbotThreadId);

    client.emit("request", {
      method: "item/tool/call",
      id: "browser-call",
      params: {
        threadId: providerThreadId,
        turnId: "turn-browser",
        callId: "browser-call",
        namespace: "openbot_browser",
        tool: "list_tabs",
        arguments: {},
      },
    });

    await waitFor(() => calls.length === 1);
    expect(calls[0]).toMatchObject({ threadId: openbotThreadId, ownerAgentId: "chief" });
  });
});
