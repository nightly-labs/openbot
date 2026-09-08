import { decodeChannelPage } from "@openbot/contracts/ipc";
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
        draft: { name: "Project", purpose: "Work together", members: [], leadAgentId: null, linkedThreadIds: [] },
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
    const legacy = await createTeamApiFixture("no-channels");
    const old = await legacy.start();
    const compatibility = await fetch(`${old.base}/v1/compatibility`);
    expect(await compatibility.json()).toMatchObject({
      capabilities: expect.not.arrayContaining(["channel-chats-v1"]),
    });
  });
});
