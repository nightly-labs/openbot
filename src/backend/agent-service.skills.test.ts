import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalSkillTools } from "./agent/skill-tools";
import type { AgentProvider } from "./agent-client";
import { AgentService } from "./agent-service";
import {
  callOpenBotTool,
  createFakeClaude,
  FakeAgentClient,
  fakeBrowser,
  startAgentTestFixture,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "./agent-service-test-harness";

let root: string;
let service: AgentService | null = null;
beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});
afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

describe.sequential("local skill provider tools", () => {
  it.each(["codex", "claude"] as const)(
    "routes %s skill tools to the caller and rejects agent overrides",
    async (provider) => {
      process.env.OPENBOT_CLAUDE_PATH = await createFakeClaude(root);
      const { store, mailbox } = stores(root);
      const clients = new Map<AgentProvider, FakeAgentClient>();
      const create = vi.fn<LocalSkillTools["create"]>().mockRejectedValue(new Error("validation test"));
      const api: LocalSkillTools = {
        create,
        revise: vi.fn<LocalSkillTools["revise"]>(),
        list: vi.fn<LocalSkillTools["list"]>().mockResolvedValue([]),
        get: vi.fn<LocalSkillTools["get"]>(),
        install: vi.fn<LocalSkillTools["install"]>(),
      };
      service = new AgentService(
        store,
        mailbox,
        fakeBrowser(),
        30_000,
        provider,
        (selected) => {
          const client = new FakeAgentClient(selected);
          clients.set(selected, client);
          return client;
        },
        undefined,
        undefined,
        null,
        null,
        null,
        undefined,
        () => api,
      );
      await service.initialize();
      await store.getOrCreate("chief");
      await service.updateAgent({
        agentId: "chief",
        provider,
        model: provider === "codex" ? "gpt-5.6-luna" : "claude-sonnet-5",
      });
      await service.sendMessage({ agentId: "chief", text: "Create a skill for weekly summaries." });
      await waitFor(() => Boolean(store.activeProviderSession("chief")?.externalSessionId));
      const client = clients.get(provider);
      const threadId = store.activeProviderSession("chief")?.externalSessionId;
      if (!client || !threadId) throw new Error("Provider session did not start.");
      await callOpenBotTool(client, threadId, "create_skill", { sourcePath: "draft" });
      expect(create).toHaveBeenCalledWith({ agentId: "chief", sourcePath: "draft" });
      create.mockClear();
      await callOpenBotTool(client, threadId, "create_skill", { sourcePath: "draft", agentId: "other" });
      expect(create).not.toHaveBeenCalled();
      await callOpenBotTool(client, threadId, "list_local_skills", {});
      expect(api.list).toHaveBeenCalledOnce();
    },
  );
});
