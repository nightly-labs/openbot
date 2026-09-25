import type { AgentSummary } from "@openbot/contracts/ipc";
import { describe, expect, it, vi } from "vitest";
import { AgentTemplateService } from "./agent-template-service";

const agent: AgentSummary = {
  id: "agent-writer",
  name: "Writer",
  title: "Editorial partner",
  description: "Drafts product writing.",
  notifications: true,
  provider: "codex",
  model: "gpt-5.6-luna",
  reasoningEffort: "medium",
  threadId: null,
  workspacePath: "/tmp/agent-writer",
  preview: "",
  updatedAt: null,
  avatarSeed: "agent-writer",
  avatarHue: 215,
  avatarUrl: null,
};

function service(
  description: string,
  markdown = "---\nname: Notes\ndescription: Take notes.\n---\nWrite notes.",
  options: { published?: boolean; skillsFail?: boolean } = {},
) {
  const requests: Array<{ path: string; method: string | undefined }> = [];
  const auth = {
    // The raw Worker answer goes through the service's own decoder, as a real response does.
    async requestAuthorized<T>(path: string, init: RequestInit, decode: (value: unknown) => T): Promise<T> {
      requests.push({ path, method: init.method });
      if (options.published && path === "/v1/agent-templates/mine")
        return decode([
          { id: "Ab3_-xYz0123456789abcd", sourceAgentId: agent.id, updatedAt: "2026-09-25T09:00:00.000Z" },
        ]);
      if (options.published && init.method === "DELETE") return decode({ deleted: true });
      throw new Error("No request is expected.");
    },
    downloadAuthorized: vi.fn(async () => new Uint8Array()),
    resolveApiUrl: (path: string) => new URL(path, "https://api.openbot.run").toString(),
  };
  const templates = new AgentTemplateService(
    auth,
    {
      listAgents: () => [{ ...agent, description }],
      listRoutines: () => [],
      resolveAvatar: () => null,
      createAgentProfile: vi.fn(async () => agent),
      setAvatar: vi.fn(async () => agent),
      createRoutine: vi.fn(() => ({ id: "routine" })),
      deleteAgent: vi.fn(async () => undefined),
    },
    {
      listTemplateSkills: async () => {
        if (options.skillsFail) throw new Error("Notes has local changes or needs repair before publishing.");
        return [{ kind: "embedded", slug: "notes", name: "Notes", markdown }];
      },
      installVersion: vi.fn(async () => undefined),
      library: () => {
        throw new Error("No library access is expected.");
      },
      installLocal: vi.fn(async () => undefined),
    },
  );
  return { templates, requests };
}

// A template is public to anyone with its link, so a secret must stop publishing before any request.
describe("publishing an agent template", () => {
  it.each([
    ["the instructions", service("Call the API with api_key=sk-live-1234567890abcdef.")],
    [
      'the skill "Notes"',
      service("Drafts product writing.", "---\nname: Notes\ndescription: x\n---\nBearer abcdefghijk"),
    ],
  ])("refuses a secret in %s and sends nothing", async (field, { templates, requests }) => {
    await expect(templates.publish({ agentId: agent.id, card: null })).rejects.toThrow(
      `Remove the secret or email address from ${field} before publishing.`,
    );
    expect(requests).toEqual([]);
  });
});

// A published agent must stay removable: a skill that cannot be published may not hide the dialog.
describe("a published agent with a skill that cannot be published", () => {
  it("still previews as published and can be unpublished, but refuses to publish", async () => {
    const { templates, requests } = service("Drafts product writing.", undefined, {
      published: true,
      skillsFail: true,
    });

    const preview = await templates.preview(agent.id);
    expect(preview.publication?.templateId).toBe("Ab3_-xYz0123456789abcd");
    expect(preview.skillsError).toBe("Notes has local changes or needs repair before publishing.");

    await templates.unpublish(agent.id);
    expect(requests).toContainEqual({ path: "/v1/agent-templates/Ab3_-xYz0123456789abcd", method: "DELETE" });
    await expect(templates.publish({ agentId: agent.id, card: null })).rejects.toThrow("local changes");
  });
});
