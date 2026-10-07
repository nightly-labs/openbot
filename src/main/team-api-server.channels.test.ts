import { decodeChannelPage } from "@openbot/contracts/ipc";
import {
  CHANNEL_COORDINATION_CAPABILITY,
  CHANNEL_COORDINATION_ROUTE,
} from "@openbot/contracts/team-protocol/channel-coordination-v1";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { stores } from "../backend/agent-service-test-harness";
import { ChannelService } from "../backend/channel-service";
import { createTeamApiFixture, stopTeamApiFixtures } from "./team-api-server-test-harness";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await stopTeamApiFixtures();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("Team API channel access", () => {
  it("gates group requests, preserves signed-in authorship, and creates each assignment once", async () => {
    const fixture = await createTeamApiFixture("channel-coordination", { configure: true });
    const data = stores(fixture.root);
    await Effect.runPromise(data.store.initialize());
    await Effect.runPromise(data.mailbox.initialize());
    await Effect.runPromise(data.store.getOrCreate("agent-a"));
    await Effect.runPromise(data.store.getOrCreate("agent-b"));
    const channels = new ChannelService(data.store.database, data.mailbox, {
      agents: () => data.store.list(),
      generate: () => Effect.sync(() => JSON.stringify({ reply: "Recorded status" })),
      schedule: () => undefined,
      interrupt: () => Effect.void,
      busy: () => true,
      changed: () => undefined,
      error: () => undefined,
    });
    cleanups.push(async () => {
      await Effect.runPromise(channels.stop());
      data.store.database.close();
    });
    await Effect.runPromise(
      channels.command(
        {
          type: "save",
          operationId: "create",
          channelId: "channel-1",
          draft: {
            name: "Team",
            title: "",
            instructions: "",
            members: [{ agentId: "agent-a" }, { agentId: "agent-b" }],
            leadAgentId: "agent-a",
          },
        },
        { id: "host", name: "Host" },
      ),
    );
    const { base } = await fixture.start({ channels });
    const token = await fixture.signIn();
    const headers = {
      Authorization: `Bearer ${token}`,
      "OpenBot-Protocol-Version": "3",
      "OpenBot-Capabilities": "channel-chats-v1",
      "Content-Type": "application/json",
    };
    const body = JSON.stringify({
      type: "coordinate",
      operationId: "all-one",
      channelId: "channel-1",
      audience: "all",
      text: "@all status",
      replyToMessageId: null,
      attachmentDraftIds: [],
      author: { id: "impostor" },
    });
    expect((await fetch(`${base}${CHANNEL_COORDINATION_ROUTE}`, { method: "POST", headers, body })).status).toBe(400);
    const supported = { ...headers, "OpenBot-Capabilities": `channel-chats-v1,${CHANNEL_COORDINATION_CAPABILITY}` };
    for (let retry = 0; retry < 2; retry++)
      expect(
        (await fetch(`${base}${CHANNEL_COORDINATION_ROUTE}`, { method: "POST", headers: supported, body })).status,
      ).toBe(200);
    expect(
      channels.store
        .tasks("channel-1")
        .map((task) => task.ownerAgentId)
        .sort(),
    ).toEqual(["agent-a", "agent-b"]);
    expect(channels.store.messages("channel-1")).toHaveLength(1);
    expect(channels.store.messages("channel-1")[0]?.author.id).not.toBe("impostor");
    expect((await fetch(`${base}/v1/channels/commands`, { method: "POST", headers: supported, body })).status).toBe(
      400,
    );
  });

  it("requires the capability and derives authorship from the signed-in caller", async () => {
    const fixture = await createTeamApiFixture("channels", { configure: true });
    const data = stores(fixture.root);
    await Effect.runPromise(data.store.initialize());
    await Effect.runPromise(data.mailbox.initialize());
    const channels = new ChannelService(data.store.database, data.mailbox, {
      agents: () => [],
      generate: () => Effect.sync(() => ""),
      schedule: () => undefined,
      interrupt: () => Effect.sync(() => undefined),
      busy: () => false,
      changed: () => undefined,
      error: () => undefined,
    });
    cleanups.push(async () => {
      await Effect.runPromise(channels.stop());
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
    const invite = await Effect.runPromise(fixture.store.createInvite("member"));
    const member = await Effect.runPromise(fixture.store.acceptInvite(invite.token, "member", "member password"));
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
});
