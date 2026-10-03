import { type AgentSummary, decodeChannelPage, isAgentSummary } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it } from "vitest";
import agentFixture from "../../packages/contracts/src/team-protocol/fixtures/v4/host-http-response.json";
import { stores } from "../backend/agent-service-test-harness";
import { ChannelService } from "../backend/channel-service";
import { createAgents, createTeamApiFixture, stopTeamApiFixtures } from "./team-api-server-test-harness";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await stopTeamApiFixtures();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("Team API channel access", () => {
  it("requires the capability and derives authorship from the signed-in caller", async () => {
    const fixture = await createTeamApiFixture("channels", { configure: true });
    const data = stores(fixture.root);
    await data.store.initialize();
    await data.mailbox.initialize();
    const channels = new ChannelService(data.store.database, data.mailbox, {
      agents: () => [],
      generate: async () => "",
      schedule: () => undefined,
      interrupt: async () => undefined,
      busy: () => false,
      changed: () => undefined,
      error: () => undefined,
    });
    cleanups.push(async () => {
      await channels.stop();
      data.store.database.close();
    });
    const { base } = await fixture.start({ channels });
    const token = await fixture.signIn();
    const headers = {
      Authorization: `Bearer ${token}`,
      "OpenBot-Protocol-Version": "3",
      "OpenBot-Capabilities": "channel-chats-v1",
      "Content-Type": "application/json",
    };
    expect((await fetch(`${base}/v1/channels`, { headers: { ...headers, "OpenBot-Capabilities": "" } })).status).toBe(
      400,
    );
    expect(
      (await fetch(`${base}/v1/channels`, { headers: { ...headers, Authorization: "Bearer invalid" } })).status,
    ).toBe(401);
    const create = await fetch(`${base}/v1/channels/commands`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "save",
        operationId: "create",
        channelId: "channel-1",
        draft: { name: "Project", title: "", instructions: "Work together", members: [], leadAgentId: null },
      }),
    });
    expect(create.status).toBe(200);
    const send = await fetch(`${base}/v1/channels/commands`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "send",
        operationId: "send",
        channelId: "channel-1",
        text: "Hello",
        recipientAgentId: null,
        replyToMessageId: null,
        attachmentDraftIds: [],
        author: { id: "impostor", name: "Impostor" },
      }),
    });
    expect(send.status).toBe(200);
    const read = await fetch(`${base}/v1/channels/read`, {
      method: "POST",
      headers,
      body: JSON.stringify({ channelId: "channel-1" }),
    });
    const page = decodeChannelPage(await read.json());
    expect(page.messages[0]?.author.id).not.toBe("impostor");
    expect(page.messages[0]?.author.kind).toBe("member");
    const deleteBody = JSON.stringify({ channelId: "channel-1" });
    const withoutDeleteCapability = await fetch(`${base}/v1/channels/delete`, {
      method: "POST",
      headers,
      body: deleteBody,
    });
    expect(withoutDeleteCapability.status).toBe(400);
    const invite = await fixture.store.createInvite("member");
    const member = await fixture.store.acceptInvite(invite.token, "member", "member password");
    const memberDelete = await fetch(`${base}/v1/channels/delete`, {
      method: "POST",
      headers: {
        ...headers,
        Authorization: `Bearer ${member.sessionToken}`,
        "OpenBot-Capabilities": "channel-chats-v1,channel-delete-v1",
      },
      body: deleteBody,
    });
    expect(memberDelete.status).toBe(403);
    const deleted = await fetch(`${base}/v1/channels/delete`, {
      method: "POST",
      headers: {
        ...headers,
        "OpenBot-Capabilities": "channel-chats-v1,channel-delete-v1",
      },
      body: deleteBody,
    });
    expect(deleted.status).toBe(204);
    expect(channels.store.exists("channel-1")).toBe(false);
    const legacy = await createTeamApiFixture("no-channels");
    const old = await legacy.start();
    const compatibility = await fetch(`${old.base}/v1/compatibility`);
    expect(await compatibility.json()).toMatchObject({
      capabilities: expect.not.arrayContaining(["channel-chats-v1"]),
    });
  });

  it("shows a channel led by a hidden agent, and a save from that peer keeps the hidden agent", async () => {
    const source = agentFixture[0];
    if (!isAgentSummary(source)) throw new Error("Invalid agent fixture.");
    const chief: AgentSummary = { ...source, id: "chief", provider: "codex", model: "gpt-5.6-luna" };
    // A custom ACP agent is hidden before protocol 5, and a Cursor agent from every protocol.
    for (const [hiddenAgent, protocol, capabilities] of [
      [{ ...source, id: "agent-acp", provider: "acp", model: "custom/opus" }, "4", "opencode"],
      [{ ...source, id: "agent-cursor", provider: "cursor", model: "auto" }, "5", "opencode,local-providers"],
    ] as const) {
      const agents: AgentSummary[] = [chief, hiddenAgent];
      const fixture = await createTeamApiFixture(`channels-${hiddenAgent.provider}`, { configure: true });
      const data = stores(fixture.root);
      await data.store.initialize();
      await data.mailbox.initialize();
      const channels = new ChannelService(data.store.database, data.mailbox, {
        agents: () => agents,
        generate: async () => "",
        schedule: () => undefined,
        interrupt: async () => undefined,
        busy: () => false,
        changed: () => undefined,
        error: () => undefined,
      });
      cleanups.push(async () => {
        await channels.stop();
        data.store.database.close();
      });
      const draft = { title: "", instructions: "", leadAgentId: hiddenAgent.id };
      await channels.command(
        {
          type: "save",
          operationId: "shared",
          channelId: "shared",
          draft: { ...draft, name: "Shared", members: [{ agentId: chief.id }, { agentId: hiddenAgent.id }] },
        },
        { id: "owner", name: "Owner" },
      );
      await channels.command(
        {
          type: "save",
          operationId: "alone",
          channelId: "alone",
          draft: { ...draft, name: "Alone", members: [{ agentId: hiddenAgent.id }] },
        },
        { id: "owner", name: "Owner" },
      );
      const { base } = await fixture.start({ channels, agents: createAgents({ listAgents: () => agents }) });
      const headers = {
        Authorization: `Bearer ${await fixture.signIn()}`,
        "OpenBot-Protocol-Version": protocol,
        "OpenBot-Capabilities": `${capabilities},channel-chats-v1`,
        "Content-Type": "application/json",
      };

      const list = await fetch(`${base}/v1/channels`, { headers });
      expect(list.status).toBe(200);
      expect(await list.json()).toMatchObject([
        { id: "shared", members: [{ agentId: chief.id }], leadAgentId: null },
        { id: "alone", members: [], leadAgentId: null },
      ]);
      const read = await fetch(`${base}/v1/channels/read`, {
        method: "POST",
        headers,
        body: JSON.stringify({ channelId: "alone" }),
      });
      expect(read.status).toBe(200);

      // The settings panel of that peer saves the whole draft it sees: the hidden lead is not in it.
      const save = await fetch(`${base}/v1/channels/commands`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          type: "save",
          operationId: "rename",
          channelId: "shared",
          update: true,
          draft: { ...draft, name: "Renamed", members: [{ agentId: chief.id }], leadAgentId: null },
        }),
      });
      expect(save.status).toBe(200);
      expect(channels.store.get("shared")).toMatchObject({
        name: "Renamed",
        members: [{ agentId: chief.id }, { agentId: hiddenAgent.id }],
        leadAgentId: hiddenAgent.id,
      });
      // A lead that the peer picks itself still wins.
      await fetch(`${base}/v1/channels/commands`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          type: "save",
          operationId: "lead",
          channelId: "shared",
          update: true,
          draft: { ...draft, name: "Renamed", members: [{ agentId: chief.id }], leadAgentId: chief.id },
        }),
      });
      expect(channels.store.get("shared")).toMatchObject({
        members: [{ agentId: chief.id }, { agentId: hiddenAgent.id }],
        leadAgentId: chief.id,
      });
    }
  });
});
