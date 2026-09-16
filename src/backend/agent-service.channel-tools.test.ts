// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProvider } from "./agent-client";
import type { AgentService } from "./agent-service";
import {
  callOpenBotTool,
  createTestService,
  FakeAgentClient,
  paramsRecord,
  startAgentTestFixture,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "./agent-service-test-harness";
import { getString } from "./protocol";

let root: string;
let service: AgentService | null = null;

beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});

afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

describe.sequential("AgentService: channel tools without assignment", () => {
  it("returns a safe tool error when a normal chat calls channel_history", async () => {
    const { store, mailbox } = stores(root);
    const clients = new Map<AgentProvider, FakeAgentClient>();
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider, "", false);
        clients.set(provider, client);
        return client;
      },
    });
    await service.initialize();
    await store.getOrCreate("chief");
    await service.sendMessage({ agentId: "chief", text: "Create agents in sections A and B." });
    await waitFor(() => Boolean(store.activeProviderSession("chief")?.externalSessionId));

    const client = clients.get("codex");
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    if (!client || !threadId) throw new Error("Provider session did not start.");

    const turnId = service.listQueue("chief").deliveries[0]?.turnId ?? "test-turn";
    const { result, error } = await callOpenBotTool(client, threadId, "channel_history", {}, turnId);

    expect(error).toBeUndefined();
    expect(result).toMatchObject({ success: false });
    const contentItems = paramsRecord(result)?.contentItems;
    const text = Array.isArray(contentItems) ? (getString(contentItems[0], "text") ?? "") : "";
    expect(text).toContain("no active channel assignment");
    expect(client.errors).toEqual([]);
  });

  it("still routes channel tools when a channel assignment exists", async () => {
    const { store, mailbox } = stores(root);
    const clients = new Map<AgentProvider, FakeAgentClient>();
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider, "", false);
        clients.set(provider, client);
        return client;
      },
    });
    await service.initialize();
    await store.getOrCreate("chief");
    await service.sendMessage({ agentId: "chief", text: "Normal chat work." });
    await waitFor(() => Boolean(store.activeProviderSession("chief")?.externalSessionId));

    const client = clients.get("codex");
    const threadId = store.activeProviderSession("chief")?.externalSessionId;
    if (!client || !threadId || !service) throw new Error("Provider session did not start.");

    const routed = { items: [] };
    const channelForThread = vi.spyOn(service.channels.store, "channelForThread").mockReturnValue("channel-1");
    const tool = vi.spyOn(service.channels, "tool").mockResolvedValue(routed);
    try {
      const turnId = service.listQueue("chief").deliveries[0]?.turnId ?? "test-turn";
      const { result, error } = await callOpenBotTool(client, threadId, "channel_history", {}, turnId);

      expect(error).toBeUndefined();
      expect(tool).toHaveBeenCalledWith("channel-1", "chief", turnId, expect.any(String), "channel_history", {});
      expect(result).toMatchObject({ success: true });
    } finally {
      channelForThread.mockRestore();
      tool.mockRestore();
    }
  });
});
