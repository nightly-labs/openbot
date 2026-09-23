// @vitest-environment node
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentService } from "../agent-service";
import {
  CREATE_AGENT_INPUT,
  createFakeClaude,
  createTestService,
  createUpdatableFakeClaude,
  FakeAgentClient,
  readTextOrEmpty,
  startAgentTestFixture,
  startService,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "../agent-service-test-harness";

let root: string;
let service: AgentService | null = null;

beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});

afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

describe.sequential("ProviderRuntime: CLI updates and key changes", () => {
  it("activates the downloaded managed CLI instead of running the user's updater", async () => {
    const system = await createUpdatableFakeClaude(root, "2.1.250");
    process.env.OPENBOT_CLAUDE_PATH = system.executable;
    const { store, mailbox } = stores(root);
    const clients: FakeAgentClient[] = [];
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "claude",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider);
        if (provider === "claude") clients.push(client);
        return client;
      },
    });
    await service.initialize();
    const managed = await createFakeClaude(root);
    await writeFile(managed, (await readFile(managed, "utf8")).replaceAll("2.1.246", "2.1.263"));
    // Remove the test's explicit override to model automatic system discovery at startup.
    process.env.OPENBOT_CLAUDE_PATH = join(root, "missing-claude");
    const status = await service.updateProviderCli("claude", async () => managed);
    expect(await readTextOrEmpty(system.started)).toBe("");
    expect(status.providers).toContainEqual(
      expect.objectContaining({ id: "claude", state: "available", version: "2.1.263", cliSource: "managed" }),
    );
    expect(clients[0]?.running).toBe(false);
    expect(clients[1]?.running).toBe(true);
  });

  it("refuses to replace a CLI that is running a turn", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => new FakeAgentClient(provider, "", false),
    });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "Keep working." });
    await waitFor(() => events.some((event) => event.type === "turn-started"));

    // The updater would replace the binary under the running turn, so it is not started at all.
    await expect(
      service.updateProviderCli("codex", async () => {
        throw new Error("Busy provider started an install.");
      }),
    ).rejects.toThrow(/working on a turn/u);

    expect(service.getStatus().providers).toContainEqual(
      expect.objectContaining({ id: "codex", state: "available", version: "0.144.1" }),
    );
  });

  it("keeps the old key while the provider is working on a turn", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => new FakeAgentClient(provider, "", false),
    });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "Keep working." });
    await waitFor(() => events.some((event) => event.type === "turn-started"));

    // Writing the key and then failing to restart would leave a key on disk that no process uses,
    // under a dialog that reports the save as failed. So a busy provider is refused first.
    let changed = false;
    await expect(
      service.changeProviderCredential("codex", async () => {
        changed = true;
      }),
    ).rejects.toThrow(/working on a turn/u);
    expect(changed).toBe(false);
  });

  it("delivers messages again after a key change that could not be saved", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => new FakeAgentClient(provider),
    });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();

    await expect(
      service.changeProviderCredential("codex", async () => {
        throw new Error("System secret storage is unavailable.");
      }),
    ).rejects.toThrow("System secret storage is unavailable.");

    // The change holds deliveries while it runs. A failed save must release them, or the agent
    // stays silent until the app restarts.
    await service.sendMessage({ agentId: "chief", text: "Still there?" });
    await waitFor(() => events.some((event) => event.type === "turn-completed"));
  });

  it("refuses to replace a CLI that is running a channel turn", async () => {
    const { service: agentService, store } = await startService(root, {
      client: (provider) => new FakeAgentClient(provider, "", false),
      preferredProvider: "codex",
    });
    service = agentService;
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
    await service.channels.command(
      {
        type: "send",
        channelId: "channel-1",
        operationId: "send",
        text: "Work in the channel.",
        recipientAgentId: "chief",
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      actor,
    );
    // A channel turn runs on a thread of its own, so the conversation of the agent holds no turn id
    // while the CLI works. The delivery has reached its turn, so no counter reports it either.
    // The assignment holds the turn id the provider answered with, so the CLI is on a turn. The
    // channel keeps that turn out of the conversation of the agent, and the delivery has left the
    // counter of the deliveries that are starting.
    await waitFor(() => service?.channels.store.assignments("channel-1").some((item) => item.turnId));

    await expect(
      service.updateProviderCli("codex", async () => {
        throw new Error("Busy provider started an install.");
      }),
    ).rejects.toThrow(/working on a turn/u);
  });

  it("refuses to replace a CLI while a delivery is on its way to a turn", async () => {
    let releaseTurnStart: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      releaseTurnStart = resolve;
    });
    let turnStartReached = false;
    const { service: agentService } = await startService(root, {
      preferredProvider: "codex",
      client: (provider) =>
        new FakeAgentClient(provider, "", false, true, {}, async (method, target) => {
          if (method !== "turn/start" || target !== "codex") return;
          turnStartReached = true;
          await blocked;
        }),
    });
    service = agentService;
    void service.sendMessage({ agentId: "chief", text: "Keep working." });
    // The delivery has no turn id yet, and the client it is about to prompt must not be replaced.
    await waitFor(() => turnStartReached);

    await expect(
      service.updateProviderCli("codex", async () => {
        throw new Error("Busy provider started an install.");
      }),
    ).rejects.toThrow(/working on a turn/u);

    releaseTurnStart?.();
  });

  it("refuses to replace a CLI that is compacting a thread", async () => {
    let releaseCompaction: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      releaseCompaction = resolve;
    });
    let compactionReached = false;
    let client: FakeAgentClient | undefined;
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => {
        const created = new FakeAgentClient(provider, "", true, true, {}, async (method, target) => {
          if (method !== "thread/compact/start" || target !== "codex") return;
          compactionReached = true;
          await blocked;
        });
        if (provider === "codex") client = created;
        return created;
      },
    });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "First large task" });
    await waitFor(() => events.some((event) => event.type === "turn-completed"));

    // A pressured thread compacts before its next message, and that compaction is a provider turn
    // the agent never owns: it holds no active turn id, so only its own guard reports it.
    client?.emit("notification", {
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "codex-session-1",
        tokenUsage: { last: { totalTokens: 82_000 }, modelContextWindow: 100_000 },
      },
    });
    void service.sendMessage({ agentId: "chief", text: "Run after compaction" });
    await waitFor(() => compactionReached);

    await expect(
      service.updateProviderCli("codex", async () => {
        throw new Error("Busy provider started an install.");
      }),
    ).rejects.toThrow(/working on a turn/u);

    releaseCompaction?.();
  });

  it("delivers a message queued while a failed update held the CLI", async () => {
    let failInstall: ((error: Error) => void) | undefined;
    const gate = new Promise<string>((_resolve, reject) => {
      failInstall = reject;
    });
    const claude = await createUpdatableFakeClaude(root, "2.1.250");
    process.env.OPENBOT_CLAUDE_PATH = claude.executable;
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "claude",
      clientFactory: (provider) => new FakeAgentClient(provider),
    });
    const running = service;
    const started: string[] = [];
    service.on("event", (event) => {
      if (event.type === "turn-started") started.push(event.agentId);
    });
    await service.initialize();
    const agent = await service.createAgent(CREATE_AGENT_INPUT);
    // The agent's own first message has to be delivered and finished, or it is the turn the
    // assertion below sees.
    await waitFor(() => started.includes(agent.id));
    await waitFor(async () => (await running.readConversation(agent.id)).activeTurnId === null);
    const turnsBefore = started.filter((agentId) => agentId === agent.id).length;

    let installing = false;
    const update = service.updateProviderCli("claude", () => {
      installing = true;
      return gate;
    });
    await waitFor(() => installing);
    await service.sendMessage({ agentId: agent.id, text: "Take this when you are back." });
    // The CLI under the client is being replaced, so the delivery waits in the mailbox.
    expect(started.filter((agentId) => agentId === agent.id)).toHaveLength(turnsBefore);

    failInstall?.(new Error("Runtime download failed."));
    // A refused update replaces no client, so nothing else would deliver what it held back.
    await expect(update).rejects.toThrow(/Runtime download failed/u);

    await waitFor(() => started.filter((agentId) => agentId === agent.id).length > turnsBefore);
  });

  // The replacement puts the provider back on the binary now on disk in one of two ways: it swaps
  // the client of a provider that has one, and it connects one whose client is gone. Neither is a
  // start, so neither may run restart recovery over the other providers' live deliveries.
  for (const claudeSignedIn of [true, false]) {
    it(`leaves another provider's running turn alone while a CLI ${
      claudeSignedIn ? "is replaced" : "with no client is connected again"
    }`, async () => {
      const claude = await createUpdatableFakeClaude(root, "2.1.250");
      process.env.OPENBOT_CLAUDE_PATH = claude.executable;
      const { store, mailbox } = stores(root);
      service = createTestService({
        store,
        mailbox,
        preferredProvider: "codex",
        clientFactory: (provider) => new FakeAgentClient(provider, "", false, claudeSignedIn || provider !== "claude"),
      });
      const running = service;
      const events: AgentEvent[] = [];
      service.on("event", (event) => events.push(event));
      await service.initialize();
      await service.sendMessage({ agentId: "chief", text: "Keep working." });
      await waitFor(() => events.some((event) => event.type === "turn-started"));
      const turnId = (await running.readConversation("chief")).activeTurnId;

      // Claude is idle, so its CLI is replaced. Restart recovery would settle every unresolved
      // delivery, and this one belongs to a turn Codex is still running.
      process.env.OPENBOT_CLAUDE_PATH = join(root, "missing-claude");
      await service.updateProviderCli("claude", async () => claude.executable);

      expect(running.listQueue("chief").deliveries[0]?.status).toBe("running");
      expect((await running.readConversation("chief")).activeTurnId).toBe(turnId);
    });
  }

  it("keeps the owner of a CLI whose provider is signed out", async () => {
    process.env.OPENBOT_CLAUDE_PATH = await createFakeClaude(root);
    const { service: agentService } = await startService(root, {
      client: (provider) => new FakeAgentClient(provider, undefined, true, provider !== "claude"),
      preferredProvider: "codex",
    });
    service = agentService;

    // Signed out, the provider keeps no client, so the row would name no owner - and an unowned CLI
    // is read as the managed copy, which sends the user's own install to a download.
    expect(service.getStatus().providers).toContainEqual(
      expect.objectContaining({ id: "claude", state: "sign-in-required", cliSource: "system" }),
    );
  });

  it("reports installation failure without replacing the working client", async () => {
    const managed = await createFakeClaude(root);
    const { service: agentService } = await startService(root, {
      client: (provider) => new FakeAgentClient(provider),
      preferredProvider: "claude",
      bundledExecutables: { claude: managed },
    });
    service = agentService;
    await expect(
      service.updateProviderCli("claude", async () => {
        throw new Error("Runtime verification failed.");
      }),
    ).rejects.toThrow("Runtime verification failed.");
    expect(service.getStatus().providers).toContainEqual(
      expect.objectContaining({ id: "claude", state: "available", version: "2.1.246" }),
    );
  });
});
