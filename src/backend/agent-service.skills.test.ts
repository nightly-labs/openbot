import { skillConversationEvent } from "@openbot/contracts/ipc";
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
      service = new AgentService({
        store,
        mailbox,
        browser: fakeBrowser(),
        requestTimeoutMs: 30_000,
        preferredProvider: provider,
        clientFactory: (selected) => {
          const client = new FakeAgentClient(selected);
          clients.set(selected, client);
          return client;
        },
        hostedSites: null,
        sidebarLayout: null,
        preferredModel: null,
        localSkillTools: () => api,
      });
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
      const failure = await callOpenBotTool(client, threadId, "create_skill", { sourcePath: "draft" });
      expect(failure.result).toEqual({
        success: false,
        contentItems: [{ type: "inputText", text: "validation test" }],
      });
      expect(create).toHaveBeenCalledWith({ agentId: "chief", sourcePath: "draft" });
      create.mockClear();
      await callOpenBotTool(client, threadId, "create_skill", { sourcePath: "draft", agentId: "other" });
      expect(create).not.toHaveBeenCalled();
      await callOpenBotTool(client, threadId, "list_local_skills", {});
      expect(api.list).toHaveBeenCalledOnce();
      const events = () =>
        store.database
          .readConversation("chief", store.list().find((a) => a.id === "chief")?.threadId ?? null)
          .messages.map(skillConversationEvent)
          .filter(Boolean);
      expect(events()).toEqual([]);
      const skill = {
        id: "local-skill-11111111-1111-4111-8111-111111111111",
        slug: "weekly-summary",
        name: "Weekly summary",
        description: "Summarize the week. password=synthetic-description-secret",
        category: "productivity" as const,
        creatorName: "Local",
        version: 1,
        installs: 0,
        featured: false,
        iconUrl: "data:image/png;base64,c3ludGhldGljLWljb24=",
        updatedAt: new Date().toISOString(),
        versionId: "revision-1",
        bundleSha256: "hash",
        files: ["SKILL.md"],
        instructions: "Summarize the week. password=synthetic-skill-secret",
        examplePrompt: "Use api_key=synthetic-example-secret",
      };
      const archivePath = "/local-skills/saved-revision/bundle.zip";
      vi.mocked(api.get).mockResolvedValue({ ...skill, archivePath });
      vi.mocked(api.list).mockResolvedValue([skill]);
      for (const tool of ["read_local_skill", "list_local_skills"]) {
        const response = await callOpenBotTool(
          client,
          threadId,
          tool,
          tool === "read_local_skill" ? { skillId: skill.id } : {},
        );
        const serialized = JSON.stringify(response.result);
        expect(serialized).not.toContain("synthetic-skill-secret");
        expect(serialized).not.toContain("synthetic-description-secret");
        expect(serialized).not.toContain("data:image");
        if (tool === "list_local_skills") expect(serialized).not.toContain("instructions");
        else expect(serialized).toContain(archivePath);
        expect(serialized).not.toContain("synthetic-example-secret");
        expect(serialized).toContain("[redacted]");
        expect(serialized).toContain(skill.id);
      }
      expect(skill.instructions).toContain("synthetic-skill-secret");
      create.mockResolvedValue(skill);
      vi.mocked(api.revise).mockResolvedValue({ ...skill, version: 2 });
      vi.mocked(api.install).mockResolvedValue({
        skillId: skill.id,
        slug: skill.slug,
        name: skill.name,
        installedVersion: 2,
        availableVersion: 2,
        state: "installed",
      });
      const created = await callOpenBotTool(client, threadId, "create_skill", { sourcePath: "draft" });
      expect(JSON.stringify(created.result)).not.toContain("data:image");
      const revised = await callOpenBotTool(client, threadId, "revise_skill", {
        skillId: skill.id,
        expectedRevision: 1,
        sourcePath: "draft",
      });
      expect(JSON.stringify(revised.result)).not.toContain("data:image");
      expect(skill.iconUrl).toContain("data:image");
      await callOpenBotTool(client, threadId, "install_local_skill", { skillId: skill.id, revision: 2 });
      expect(events()).toEqual([
        { action: "created", skillId: skill.id, revision: 1, skillName: skill.name },
        { action: "revised", skillId: skill.id, revision: 2, skillName: skill.name },
        { action: "installed", skillId: skill.id, revision: 2, skillName: skill.name },
      ]);
      await waitFor(() => service?.listQueue("chief").deliveries.every((delivery) => delivery.status === "completed"));
      const actor = { id: "human", name: "Alex" };
      await service.channels.command(
        {
          type: "save",
          channelId: "skills-channel",
          operationId: "create",
          draft: {
            name: "Skills",
            title: "",
            instructions: "Test skills",
            members: [{ agentId: "chief" }],
            leadAgentId: "chief",
          },
        },
        actor,
      );
      await service.channels.command(
        {
          type: "send",
          channelId: "skills-channel",
          operationId: "send",
          text: "Create a skill",
          recipientAgentId: "chief",
          replyToMessageId: null,
          attachmentDraftIds: [],
        },
        actor,
      );
      await waitFor(() => service?.channels.store.tasks("skills-channel")[0]?.state === "completed");
      const execution = service.channels.store.context("skills-channel", "chief");
      const session = store.database.activeProviderSession(execution.threadId, provider);
      if (!session) throw new Error("Channel session did not start.");
      await callOpenBotTool(client, session.externalSessionId, "create_skill", { sourcePath: "channel-draft" });
      expect(events()).toHaveLength(3);
      expect(
        store.database
          .readConversation("chief", execution.threadId)
          .messages.map(skillConversationEvent)
          .filter(Boolean),
      ).toEqual([{ action: "created", skillId: skill.id, revision: 1, skillName: skill.name }]);
    },
  );
});
