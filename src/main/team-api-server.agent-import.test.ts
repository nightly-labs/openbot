// @vitest-environment node

// Who may import agents into the host from a joined server. The authority is deliberate and frozen by
// `agent-import-v1`: every member imports, not only an owner or an admin. The token is the member's
// own, and a member never revises a skill of the host.

import type { AgentImportPreview, AgentImportResult, AgentSummary } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentImportCaller } from "./agent-import-service";
import { createTeamApiFixture, stopTeamApiFixtures, type TeamApiOptions } from "./team-api-server-test-harness";

afterEach(stopTeamApiFixtures);

/** The preview agent as the wire carries it: no avatar. */
const wireAgent = {
  key: "research",
  name: "Research",
  title: "Analyst",
  description: "You are research.",
  skillCount: 0,
  routineCount: 0,
  memoryCount: 0,
  fileCount: 0,
  fileBytes: 0,
  nameExists: false,
};
const preview: AgentImportPreview = {
  token: "token-1",
  sourceApp: "grok-bot",
  exportedAt: null,
  agents: [{ ...wireAgent, avatarUrl: "data:image/png;base64,AAAA" }],
  channels: [],
  warnings: [],
};

function createAgentImport(): NonNullable<TeamApiOptions["agentImport"]> & {
  staged: Array<{ bytes: number[]; owner: string }>;
  applied: AgentImportCaller[];
} {
  const staged: Array<{ bytes: number[]; owner: string }> = [];
  const applied: AgentImportCaller[] = [];
  return {
    staged,
    applied,
    stageUpload: async (read, owner) => {
      staged.push({ bytes: [...(await read())], owner });
      return preview;
    },
    apply: async (_input, caller): Promise<AgentImportResult> => {
      if (caller) applied.push(caller);
      const agent: AgentSummary = {
        id: "agent-1",
        name: "Research",
        title: "Analyst",
        description: "You are research.",
        provider: "codex",
        notifications: true,
        model: "gpt-5.6-luna",
        reasoningEffort: "medium",
        threadId: null,
        workspacePath: "/Users/host/OpenBot/agent-1",
        preview: "",
        updatedAt: null,
        avatarSeed: "research",
        avatarHue: null,
        avatarUrl: null,
      };
      return { agents: [agent], skipped: [], channels: [], skippedChannels: [], warnings: [] };
    },
    discard: () => undefined,
  };
}

describe("Team API agent import", () => {
  it("lets a member import, as that member, without avatars in the preview", async () => {
    const agentImport = createAgentImport();
    const fixture = await createTeamApiFixture("agent-import", { configure: true });
    const { base } = await fixture.start({ agentImport });
    const invite = await fixture.store.createInvite("member");
    const member = await fixture.store.acceptInvite(invite.token, "member", "member password");
    const headers = {
      Authorization: `Bearer ${member.sessionToken}`,
      "OpenBot-Protocol-Version": "3",
      "OpenBot-Capabilities": "agent-import-v1",
    };

    // Without the capability the routes answer 400: the connection did not ask for the feature.
    const refused = await fetch(`${base}/v1/agent-import/stage`, {
      method: "POST",
      headers: { ...headers, "OpenBot-Capabilities": "" },
      body: new Uint8Array([1]),
    });
    expect(refused.status).toBe(400);

    const staged = await fetch(`${base}/v1/agent-import/stage`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/zip" },
      body: new Uint8Array([80, 75, 3, 4]),
    });
    expect(staged.status).toBe(200);
    expect(await staged.json()).toEqual({ ...preview, agents: [wireAgent] });
    expect(agentImport.staged).toEqual([{ bytes: [80, 75, 3, 4], owner: member.member.id }]);

    const applied = await fetch(`${base}/v1/agent-import/apply`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ token: "token-1", keys: ["research"], channelKeys: [], timezone: "Europe/Warsaw" }),
    });
    expect(applied.status).toBe(200);
    expect(await applied.json()).toEqual({
      agents: [{ agentId: "agent-1", name: "Research" }],
      skipped: [],
      channels: [],
      skippedChannels: [],
      warnings: [],
    });
    expect(agentImport.applied).toEqual([
      {
        owner: member.member.id,
        actor: { id: member.member.id, name: expect.any(String) },
        timezone: "Europe/Warsaw",
        reviseSkills: false,
      },
    ]);

    const compatibility = await (await fetch(`${base}/v1/compatibility`)).json();
    expect(compatibility).toMatchObject({ capabilities: expect.arrayContaining(["agent-import-v1"]) });
  });

  it("does not advertise agent import when the host has no import service", async () => {
    const fixture = await createTeamApiFixture("agent-import-absent", { configure: true });
    const { base } = await fixture.start({});
    const compatibility = await (await fetch(`${base}/v1/compatibility`)).json();
    expect(compatibility.capabilities).not.toContain("agent-import-v1");
  });
});
