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

function service(description: string, markdown = "---\nname: Notes\ndescription: Take notes.\n---\nWrite notes.") {
  const auth = {
    requestAuthorized: vi.fn(async () => {
      throw new Error("No request is expected.");
    }),
    downloadAuthorized: vi.fn(async () => new Uint8Array()),
    resolveApiUrl: (path: string) => path,
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
      listTemplateSkills: async () => [{ kind: "embedded", slug: "notes", name: "Notes", markdown }],
      installVersion: vi.fn(async () => undefined),
      library: () => {
        throw new Error("No library access is expected.");
      },
      installLocal: vi.fn(async () => undefined),
    },
  );
  return { templates, auth };
}

// A template is public to anyone with its link, so a secret must stop publishing before any request.
describe("publishing an agent template", () => {
  it.each([
    ["the instructions", service("Call the API with api_key=sk-live-1234567890abcdef.")],
    [
      'the skill "Notes"',
      service("Drafts product writing.", "---\nname: Notes\ndescription: x\n---\nBearer abcdefghijk"),
    ],
  ])("refuses a secret in %s and sends nothing", async (field, { templates, auth }) => {
    await expect(templates.publish({ agentId: agent.id, card: null })).rejects.toThrow(
      `Remove the secret or email address from ${field} before publishing.`,
    );
    expect(auth.requestAuthorized).not.toHaveBeenCalled();
  });
});
