// @vitest-environment node
import { createHash } from "node:crypto";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent, BrowserTab } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentService } from "./agent-service";
import {
  createTestService,
  FakeAgentClient,
  fakeBrowser,
  nextRoutinesChanged,
  startAgentTestFixture,
  startService,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "./agent-service-test-harness";

let root: string;

let service: AgentService | null = null;

/**
 * What a stdio MCP server is launched with: this user's own `PATH`, then the configuration's pairs.
 * The `PATH` is what makes a command found through a login shell runnable outside a terminal.
 */

beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});

afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

const browserTab = (id: string, ownerAgentId: string | null, ownerThreadId: string | null): BrowserTab => ({
  id,
  title: id,
  url: `https://example.com/${id}`,
  loading: false,
  ownerThreadId,
  ownerAgentId,
});

describe.sequential("AgentService: agent deletion", () => {
  it("deletes idle agents and refuses to orphan active work", async () => {
    const { store, mailbox } = stores(root);
    let revokeFails = true;
    const deleteWithRevokedApproval = vi.fn(async (_agentId: string, remove: () => Promise<void>) => {
      if (revokeFails) throw new Error("Approval revocation failed.");
      await remove();
    });
    service = createTestService({ store, mailbox, deleteWithRevokedApproval });
    await service.initialize();

    const deletedAgent = await store.getOrCreate("sales-outbound");
    store.ensureThreadIdNow(deletedAgent.id);
    store.database.recordPendingHostedSiteTerminalEvent({
      agentId: deletedAgent.id,
      threadId: "provider-thread-sales-outbound",
      turnId: "turn-delete-agent",
      operationId: "operation-delete-agent",
      action: "replace",
      status: "succeeded",
      details: {
        siteId: "site-delete-agent",
        title: "Deleted agent site",
        hostname: null,
        url: null,
      },
      markerCommandId: `hosted-site-event:${deletedAgent.id}:operation-delete-agent:succeeded`,
      createdAt: "2026-09-01T12:00:00.000Z",
    });
    expect(store.database.pendingHostedSiteTerminalEvents()).toHaveLength(1);
    await expect(service.deleteAgent("sales-outbound")).rejects.toThrow(
      "The agent data could not be removed completely.",
    );
    expect(service.listAgents().some((agent) => agent.id === "sales-outbound")).toBe(true);
    revokeFails = false;
    await service.deleteAgent("sales-outbound");
    await expect(service.deleteAgent("sales-outbound")).resolves.toBeUndefined();
    expect(service.listAgents().some((agent) => agent.id === "sales-outbound")).toBe(false);
    expect(store.database.pendingHostedSiteTerminalEvents()).toEqual([]);
    expect(
      store.database.connection
        .prepare(
          `SELECT COUNT(*) AS count FROM orchestration_events
           WHERE payload_json LIKE '%sales-outbound%'`,
        )
        .get(),
    ).toMatchObject({ count: 0 });
    expect(
      store.database.connection
        .prepare(
          `SELECT COUNT(*) AS count FROM orchestration_command_receipts
           WHERE command_id LIKE '%sales-outbound%'`,
        )
        .get(),
    ).toMatchObject({ count: 0 });

    await service.sendMessage({ agentId: "chief", text: "Keep working" });
    await waitFor(() => service?.listQueue("chief").deliveries[0]?.status === "running");
    await expect(service.deleteAgent("chief")).rejects.toThrow(
      "Stop the agent and cancel its queued messages before deleting it.",
    );
    expect(service.listAgents().some((agent) => agent.id === "chief")).toBe(true);
  });

  it("keeps an agent available for retry when mailbox deletion fails", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    await service.initialize();
    const agent = await store.getOrCreate("delete-retry");
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    vi.spyOn(mailbox, "deleteAgentData").mockRejectedValueOnce(new Error("private/path secret"));

    await expect(service.deleteAgent(agent.id)).rejects.toThrow("The agent data could not be removed completely.");
    expect(service.listAgents().some((entry) => entry.id === agent.id)).toBe(true);
    expect(events.filter((event) => event.type === "agents-changed")).toEqual([]);

    await service.deleteAgent(agent.id);
    expect(service.listAgents().some((entry) => entry.id === agent.id)).toBe(false);
    expect(events).toContainEqual({ type: "agents-changed", agents: service.listAgents() });
  });

  it("holds due routines and rejects messages during deletion, then resumes after failure", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      // Keep the resumed turn running until the test can observe it.
      clientFactory: (provider) => new FakeAgentClient(provider, "", false),
    });
    await service.initialize();
    const agent = await store.getOrCreate("delete-routine");
    vi.useFakeTimers({ now: new Date("2026-08-25T11:00:00.000Z") });
    let releaseCleanup: (() => void) | undefined;
    const cleanupGate = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    vi.spyOn(mailbox, "deleteAgentData").mockImplementationOnce(async () => {
      await cleanupGate;
      throw new Error("Cleanup failed");
    });
    const routine = service.createRoutine({
      agentId: agent.id,
      name: "Check during deletion",
      instruction: "Check the queue.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "interval", amount: 15, unit: "minutes", anchorAt: "2026-08-25T11:00:00.000Z" },
    });
    const deletion = service.deleteAgent(agent.id);
    const failedDeletion = expect(deletion).rejects.toThrow("Retry deleting the agent.");
    try {
      await vi.advanceTimersByTimeAsync(15 * 60_000);
      expect(service.listRoutineRuns({ agentId: agent.id, routineId: routine.id })).toEqual([]);
      await expect(service.testRoutine({ agentId: agent.id, routineId: routine.id })).rejects.toThrow(
        "Wait until the agent operation finishes before running a routine.",
      );
      await expect(service.sendMessage({ agentId: agent.id, text: "Wait for cleanup." })).rejects.toThrow(
        "The recipient is being deleted. Retry after deletion finishes.",
      );
      expect(service.listQueue(agent.id).deliveries).toEqual([]);
      expect(store.activeProviderSession(agent.id)).toBeNull();
      await expect(service.deleteAgent(agent.id)).rejects.toThrow("Agent deletion is already in progress.");

      releaseCleanup?.();
      await failedDeletion;
      const changed = nextRoutinesChanged(service, agent.id);
      await vi.advanceTimersByTimeAsync(0);
      await changed;
      expect(service.listRoutineRuns({ agentId: agent.id, routineId: routine.id })).toEqual([
        expect.objectContaining({ kind: "scheduled" }),
      ]);
      vi.useRealTimers();
      await waitFor(() => service?.listQueue(agent.id).deliveries.some((delivery) => delivery.status === "running"));
    } finally {
      releaseCleanup?.();
      await failedDeletion;
      vi.useRealTimers();
    }
  });
  it("closes a deleted agent's browser tabs and leaves another agent's tabs open", async () => {
    const { store, mailbox } = stores(root);
    const tabs: BrowserTab[] = [];
    const closed: string[] = [];
    const browser = fakeBrowser(tabs);
    browser.close = async (tabId: string) => {
      closed.push(tabId);
    };
    service = createTestService({ store, mailbox, browser });
    await service.initialize();
    const deleted = await store.getOrCreate("tab-owner");
    const kept = await store.getOrCreate("tab-keeper");
    // A fresh agent holds no thread until its first turn, and the legacy owner rule matches on the
    // thread id, so give both agents one.
    const deletedThreadId = store.ensureThreadIdNow(deleted.id);
    const keptThreadId = store.ensureThreadIdNow(kept.id);
    tabs.push(
      browserTab("tab-owned", deleted.id, deletedThreadId),
      // A tab from a build that stored only the thread id. The renderer still groups it under this
      // agent, so deleting the agent has to take it too.
      browserTab("tab-legacy", null, deletedThreadId),
      browserTab("tab-other", kept.id, keptThreadId),
    );

    await service.deleteAgent(deleted.id);

    expect(closed).toEqual(["tab-owned", "tab-legacy"]);
  });

  it("still deletes the agent when closing one of its browser tabs fails", async () => {
    const { store, mailbox } = stores(root);
    const tabs: BrowserTab[] = [];
    const browser = fakeBrowser(tabs);
    browser.close = async () => {
      throw new Error("could not close");
    };
    service = createTestService({ store, mailbox, browser });
    await service.initialize();
    const agent = await store.getOrCreate("tab-close-failure");
    tabs.push(browserTab("tab-stuck", agent.id, store.ensureThreadIdNow(agent.id)));

    await expect(service.deleteAgent(agent.id)).resolves.toBeUndefined();
    expect(service.listAgents().some((entry) => entry.id === agent.id)).toBe(false);
  });

  it("keeps an agent with active channel work from being deleted", async () => {
    const { service: agentService, store } = await startService(root, {
      provider: "codex",
      output: "",
      autoComplete: false,
      preferredProvider: "codex",
    });
    service = agentService;
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
});
