// @vitest-environment node
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEVELOPMENT_DEFAULT_MODEL, DEVELOPMENT_DEFAULT_REASONING_EFFORT } from "./agent/development-defaults";
import type { AgentProvider } from "./agent-client";
import type { AgentService } from "./agent-service";
import {
  CREATE_AGENT_INPUT,
  createFakeClaude,
  createFakeOpencode,
  createTestService,
  FakeAgentClient,
  firstInputText,
  startAgentTestFixture,
  startService,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "./agent-service-test-harness";
import { MailboxStore } from "./mailbox-store";

let root: string;
let service: AgentService | null = null;

beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});

afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

describe.sequential("AgentService: queue (1/3)", () => {
  it("sends an edited delivery once after a repeated save and drains past a deleted hold", async () => {
    const { service: agentService, client, store, mailbox } = await startService(root, { provider: "codex" });
    service = agentService;
    await store.getOrCreate("chief");
    const first = await mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: ["chief"], text: "Original" });
    const deliveryId = first.deliveries[0].id;
    const editing = await service.editQueuedMessage("chief", { action: "begin", deliveryId, editId: "phone-edit" });
    expect(editing.deliveries[0]).toMatchObject({ id: deliveryId, text: "Original" });
    // Every device keeps the row, marked as being edited, rather than watching it disappear.
    expect(service.listQueue("chief").deliveries).toMatchObject([{ id: deliveryId, editing: true, position: 1 }]);
    expect(mailbox.nextQueued("chief")).toBeNull();
    const save = {
      action: "save" as const,
      deliveryId,
      editId: "phone-edit",
      text: "Edited on phone",
      keepAttachmentIds: [],
      attachmentDraftIds: [],
    };
    await service.editQueuedMessage("chief", save);
    await service.editQueuedMessage("chief", save);
    await expect(service.editQueuedMessage("chief", { ...save, text: "Changed after lost response" })).rejects.toThrow(
      "different contents",
    );
    await expect(
      service.editQueuedMessage("chief", { ...save, keepAttachmentIds: ["different-file"] }),
    ).rejects.toThrow("different contents");
    const file = join(root, "retry-upload.txt");
    await writeFile(file, "New attachment after lost response");
    const [draft] = await mailbox.prepareImportedAttachments([file], []);
    await expect(service.editQueuedMessage("chief", { ...save, attachmentDraftIds: [draft.id] })).rejects.toThrow(
      "different contents",
    );
    await expect(
      mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: ["chief"], text: "Reuse", draftIds: [draft.id] }),
    ).rejects.toThrow("no longer exists");
    const restored = new MailboxStore(join(root, "user-data"), store.sharedRoot, store.database);
    await restored.initialize();
    expect(restored.matchesFinishedQueueSave("chief", deliveryId, save.editId, save.text, [], [])).toBe(true);
    expect(restored.matchesFinishedQueueSave("chief", deliveryId, save.editId, "Changed", [], [])).toBe(false);
    expect(restored.listQueue("chief").deliveries[0]).not.toHaveProperty("finishedEditOutcomes");

    await waitFor(() => mailbox.listQueue("chief").deliveries[0]?.status === "completed");
    const starts = client.requests.filter((request) => request.method === "turn/start");
    expect(starts).toHaveLength(1);
    expect(firstInputText(starts[0].params)).toContain("Edited on phone");
    const removed = await mailbox.enqueue({
      sender: { kind: "user" },
      recipientAgentIds: ["chief"],
      text: "Never send this",
    });
    await service.editQueuedMessage("chief", {
      action: "begin",
      deliveryId: removed.deliveries[0].id,
      editId: "removed-edit",
    });
    const next = await mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: ["chief"], text: "Continue" });
    await service.cancelQueuedMessage("chief", removed.deliveries[0].id);
    // Deletion finishes the edit too: cancellation retries confirm, but Save cannot revive it.
    const cancelRemoved = { action: "cancel" as const, deliveryId: removed.deliveries[0].id, editId: "removed-edit" };
    await service.editQueuedMessage("chief", cancelRemoved);
    await service.editQueuedMessage("chief", cancelRemoved);
    await expect(
      service.editQueuedMessage("chief", {
        ...save,
        deliveryId: cancelRemoved.deliveryId,
        editId: cancelRemoved.editId,
      }),
    ).rejects.toThrow("cancelled");
    await waitFor(
      () =>
        mailbox.listQueue("chief").deliveries.find((item) => item.id === next.deliveries[0].id)?.status === "completed",
    );
    expect(client.requests.filter((request) => request.method === "turn/start")).toHaveLength(2);
    expect(mailbox.listQueue("chief").deliveries.find((item) => item.id === removed.deliveries[0].id)?.status).toBe(
      "cancelled",
    );
  });

  it("confirms an earlier save retry after another device saves the same message", async () => {
    const { store, mailbox } = stores(root);
    // The active turn never completes, so the edited message waits queued behind it.
    const client = new FakeAgentClient("codex", "CODEX_DONE", false);
    service = createTestService({ store, mailbox, clientFactory: () => client });
    await service.initialize();
    await store.getOrCreate("chief");
    await service.sendMessage({ agentId: "chief", text: "Active task" });
    const first = await mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: ["chief"], text: "Original" });
    const deliveryId = first.deliveries[0].id;
    const saveA = {
      action: "save" as const,
      deliveryId,
      editId: "device-a-edit",
      text: "Edited on A",
      keepAttachmentIds: [],
      attachmentDraftIds: [],
    };
    await service.editQueuedMessage("chief", { action: "begin", deliveryId, editId: "device-a-edit" });
    await service.editQueuedMessage("chief", saveA);
    // The message stays queued, so a second device edits and saves it again. That
    // must not forget the first save: its exact retry still confirms.
    await service.editQueuedMessage("chief", { action: "begin", deliveryId, editId: "device-b-edit" });
    const saveB = { ...saveA, editId: "device-b-edit", text: "Edited on B" };
    await service.editQueuedMessage("chief", saveB);
    await service.editQueuedMessage("chief", saveA);
    // The retry confirms without re-applying superseded text over the newer save.
    const queued = service.listQueue("chief").deliveries.find((item) => item.id === deliveryId);
    expect(queued).toMatchObject({ text: "Edited on B" });
    // A cancel reports the recorded save instead of overwriting its outcome,
    // so the second device keeps its own confirmation.
    await expect(
      service.editQueuedMessage("chief", { action: "cancel", deliveryId, editId: "device-a-edit" }),
    ).rejects.toThrow("already saved");
    await service.editQueuedMessage("chief", saveB);
    const restored = new MailboxStore(join(root, "user-data"), store.sharedRoot, store.database);
    await restored.initialize();
    expect(restored.matchesFinishedQueueSave("chief", deliveryId, "device-a-edit", "Edited on A", [], [])).toBe(true);
    expect(restored.matchesFinishedQueueSave("chief", deliveryId, "device-b-edit", "Edited on B", [], [])).toBe(true);
  });

  it("rejects a save that repeats a finished cancellation and keeps the original message", async () => {
    const { service: agentService, client, store, mailbox } = await startService(root, { provider: "codex" });
    service = agentService;
    await store.getOrCreate("chief");
    const first = await mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: ["chief"], text: "Original" });
    const deliveryId = first.deliveries[0].id;
    await service.editQueuedMessage("chief", { action: "begin", deliveryId, editId: "phone-edit" });
    await service.editQueuedMessage("chief", { action: "cancel", deliveryId, editId: "phone-edit" });
    const file = join(root, "late-upload.txt");
    await writeFile(file, "Late upload");
    const [draft] = await mailbox.prepareImportedAttachments([file], []);
    // A cancel whose response was lost leaves the editor open. The save that follows it
    // must report the rejection instead of success, so the client keeps the typed text.
    await expect(
      service.editQueuedMessage("chief", {
        action: "save",
        deliveryId,
        editId: "phone-edit",
        text: "Edited on phone",
        keepAttachmentIds: [],
        attachmentDraftIds: [draft.id],
      }),
    ).rejects.toThrow("cancelled");
    // The upload belonged to the finished edit, so the host keeps no orphan draft.
    await expect(
      mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: ["chief"], text: "Reuse", draftIds: [draft.id] }),
    ).rejects.toThrow("no longer exists");
    await waitFor(() => mailbox.listQueue("chief").deliveries[0]?.status === "completed");
    const starts = client.requests.filter((request) => request.method === "turn/start");
    expect(starts).toHaveLength(1);
    expect(firstInputText(starts[0].params)).toContain("Original");
  });

  it("starts a new agent in a development build on the OpenCode development model", async () => {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      developmentDefaults: true,
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider);
        if (provider === "opencode") {
          client.modelList = () => ({
            data: [{ model: "opencode/muse-spark-1.3-contributor-free" }, { model: DEVELOPMENT_DEFAULT_MODEL }],
          });
        }
        return client;
      },
    });

    await service.initialize();
    await service.ensureProvider("opencode");

    // The developer asked for this model at this effort, and OpenCode lists it, so the built-in
    // `codex` default steps aside -- provider included, because the model belongs to OpenCode.
    await expect(service.createAgent(CREATE_AGENT_INPUT)).resolves.toMatchObject({
      provider: "opencode",
      model: DEVELOPMENT_DEFAULT_MODEL,
      reasoningEffort: DEVELOPMENT_DEFAULT_REASONING_EFFORT,
    });
  });

  it("leaves a packaged build and a recorded preference on their own model", async () => {
    process.env.OPENBOT_CLAUDE_PATH = await createFakeClaude(root);
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    const { service: agentService } = await startService(root, {
      client: (provider) => {
        const client = new FakeAgentClient(provider);
        if (provider === "opencode") client.modelList = () => ({ data: [{ model: DEVELOPMENT_DEFAULT_MODEL }] });
        return client;
      },
    });
    service = agentService;

    await service.ensureProvider("opencode");

    // Same catalog, no development build: the built-in default stands.
    await expect(service.createAgent(CREATE_AGENT_INPUT)).resolves.toMatchObject({
      provider: "codex",
      model: "gpt-5.6-luna",
    });

    // And a provider the developer chose is theirs, development build or not.
    await service.setPreferredProvider("claude");
    await expect(
      service.createAgent({ ...CREATE_AGENT_INPUT, name: "Chosen Agent", avatarSeed: "setup:chosen" }),
    ).resolves.toMatchObject({
      provider: "claude",
      model: "claude-sonnet-5",
    });
  });

  it("starts a new agent on the requested provider and model before the initial message", async () => {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    const { store, mailbox } = stores(root);
    const clients = new Map<AgentProvider, FakeAgentClient>();
    service = createTestService({
      store,
      mailbox,
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider);
        if (provider === "opencode") client.modelList = () => ({ data: [{ model: "opencode/example-model" }] });
        clients.set(provider, client);
        return client;
      },
    });
    await service.initialize();

    await expect(
      service.createAgent({ ...CREATE_AGENT_INPUT, provider: "opencode", model: "opencode/example-model" }),
    ).resolves.toMatchObject({ provider: "opencode", model: "opencode/example-model" });
    // The initial turn ran on the requested provider: a follow-up provider change would be rejected
    // as active work, so the record has to name it before the first message is queued.
    await waitFor(
      () =>
        clients.get("opencode")?.requests.some((request) => request.method === "turn/start") === true &&
        clients.get("codex")?.requests.some((request) => request.method === "turn/start") !== true,
    );
  });

  it("rejects creation with an unlisted model and removes the incomplete agent", async () => {
    process.env.OPENBOT_OPENCODE_PATH = await createFakeOpencode(root);
    const { service: agentService } = await startService(root, {
      client: (provider) => new FakeAgentClient(provider),
    });
    service = agentService;

    await expect(
      service.createAgent({ ...CREATE_AGENT_INPUT, provider: "opencode", model: "opencode/no-such-model" }),
    ).rejects.toThrow("The selected agent model is unavailable.");
    expect(service.listAgents()).toEqual([]);
  });

  it("updates the active account and new-agent defaults with the preferred provider", async () => {
    process.env.OPENBOT_CLAUDE_PATH = await createFakeClaude(root);
    const { service: agentService } = await startService(root, { preferredProvider: "claude" });
    service = agentService;

    expect(service.getStatus()).toMatchObject({
      phase: "ready",
      auth: { kind: "claude", email: "claude@example.com" },
      providers: [
        {
          id: "codex",
          state: "available",
          version: "0.144.1",
          email: "codex@example.com",
        },
        {
          id: "claude",
          state: "available",
          version: "2.1.246",
          email: "claude@example.com",
        },
        { id: "grok", state: "not-installed", version: null },
        { id: "opencode", state: "not-installed", version: null },
      ],
    });
    await expect(
      service.createAgent({
        ...CREATE_AGENT_INPUT,
        name: "Claude Planning Agent",
        avatarSeed: "setup:claude-planning",
      }),
    ).resolves.toMatchObject({
      model: "claude-sonnet-5",
      reasoningEffort: "high",
    });
    await service.setPreferredProvider("codex");
    expect(service.getStatus()).toMatchObject({
      auth: { kind: "chatgpt", email: "codex@example.com" },
      cliVersion: "0.144.1",
    });
    // The store default, which is what a new agent on the default provider keeps: `low`, not the
    // `medium` the Codex CLI reports for every GPT-5.6 model.
    await expect(service.createAgent(CREATE_AGENT_INPUT)).resolves.toMatchObject({
      model: "gpt-5.6-luna",
      reasoningEffort: "low",
    });
    // Setup can record a model beside the provider, which is how a custom endpoint becomes the
    // default: it is a model of the CLI that runs it, so only the model names it.
    await service.setPreferredProvider("claude", "claude-opus-5");
    await expect(
      service.createAgent({ ...CREATE_AGENT_INPUT, name: "Opus Agent", avatarSeed: "setup:opus" }),
    ).resolves.toMatchObject({
      provider: "claude",
      model: "claude-opus-5",
      reasoningEffort: "high",
    });
    // A recorded model the provider no longer lists is ignored, so a new agent still starts usable.
    await service.setPreferredProvider("claude", "claude-retired-9");
    await expect(
      service.createAgent({ ...CREATE_AGENT_INPUT, name: "Fallback Agent", avatarSeed: "setup:fallback" }),
    ).resolves.toMatchObject({
      provider: "claude",
      model: "claude-sonnet-5",
    });
  });

  it("detects a newly installed provider without disconnecting an available one", async () => {
    const codexPath = process.env.OPENBOT_CODEX_PATH;
    if (!codexPath) throw new Error("The fake Codex path is missing.");
    process.env.OPENBOT_CODEX_PATH = join(root, "missing-codex");
    const workingDirectory = process.cwd();
    process.chdir(root);
    const clients = new Map<AgentProvider, FakeAgentClient>();
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider);
        clients.set(provider, client);
        return client;
      },
    });
    try {
      await service.initialize();
      expect(service.getStatus()).toMatchObject({
        phase: "blocked",
        providers: [
          { id: "codex", state: "error", message: expect.stringContaining("included ChatGPT runtime") },
          { id: "claude", state: "error", message: expect.stringContaining("included Claude runtime") },
          { id: "grok", state: "not-installed" },
          { id: "opencode", state: "not-installed" },
        ],
      });

      process.env.OPENBOT_CODEX_PATH = codexPath;
      await expect(service.refreshProviders()).resolves.toMatchObject({
        phase: "ready",
        providers: [
          { id: "codex", state: "available" },
          { id: "claude", state: "error", message: expect.stringContaining("included Claude runtime") },
          { id: "grok", state: "not-installed" },
          { id: "opencode", state: "not-installed" },
        ],
      });
      const codexClient = clients.get("codex");
      expect(codexClient?.running).toBe(true);

      await service.refreshProviders();

      expect(clients.get("codex")).toBe(codexClient);
      expect(codexClient?.running).toBe(true);
      expect(service.getStatus().providers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "codex", state: "available" }),
          expect.objectContaining({ id: "claude", state: "error" }),
          expect.objectContaining({ id: "grok", state: "not-installed" }),
        ]),
      );
    } finally {
      process.chdir(workingDirectory);
    }
  });

  it("returns a provider refresh before runtime metadata finishes loading", async () => {
    const { store, mailbox } = stores(root);
    let holdMetadata = false;
    let releaseMetadata: (() => void) | undefined;
    const metadataReleased = new Promise<void>((resolve) => {
      releaseMetadata = resolve;
    });
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) =>
        new FakeAgentClient(provider, "DONE", true, true, {}, async (method) => {
          if (holdMetadata && (method === "model/list" || method === "plugin/list")) await metadataReleased;
        }),
    });
    await service.initialize();
    holdMetadata = true;

    const outcome = await Promise.race([
      service.refreshProviders().then(() => "resolved" as const),
      new Promise<"timed-out">((resolve) => setTimeout(() => resolve("timed-out"), 500)),
    ]);
    releaseMetadata?.();

    expect(outcome).toBe("resolved");
    expect(service.getStatus().phase).toBe("ready");
  });

  it("keeps a connected provider and surfaces its account refresh warning", async () => {
    const { store, mailbox } = stores(root);
    let accountReads = 0;
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) =>
        new FakeAgentClient(provider, "DONE", true, true, {}, async (method) => {
          if (method === "account/read" && ++accountReads === 2) throw new Error("Temporary account API failure");
        }),
    });
    await service.initialize();

    await service.refreshProviders();

    expect(service.getStatus().providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "codex",
          state: "available",
          checkError: "Could not verify ChatGPT. Keeping the existing connection.",
        }),
      ]),
    );
  });

  it("removes a new Agent and its workspace when the first message cannot enter the queue", async () => {
    const { service: agentService, store, mailbox } = await startService(root);
    service = agentService;
    vi.spyOn(mailbox, "enqueue").mockRejectedValueOnce(new Error("Queue write failed."));

    await expect(service.createAgent(CREATE_AGENT_INPUT)).rejects.toThrow("Queue write failed.");

    expect(service.listAgents()).toEqual([]);
    expect(store.database.listAgents()).toEqual([]);
    await expect(readdir(join(root, "home", "OpenBot", "Agents"))).resolves.toEqual([]);
  });
});
