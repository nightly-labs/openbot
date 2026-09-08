import { decodeGroupPage } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it } from "vitest";
import { stores } from "../backend/agent-service-test-harness";
import { GroupService } from "../backend/group-service";
import { createTeamApiFixture, stopTeamApiFixtures } from "./team-api-server-test-harness";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await stopTeamApiFixtures();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("Team API group access", () => {
  it("requires the capability and derives authorship from the signed-in caller", async () => {
    const fixture = await createTeamApiFixture("groups", { configure: true });
    const data = stores(fixture.root);
    await data.store.initialize();
    await data.mailbox.initialize();
    const groups = new GroupService(data.store.database, data.mailbox, {
      agents: () => [],
      generate: async () => "",
      schedule: () => undefined,
      interrupt: async () => undefined,
      busy: () => false,
      changed: () => undefined,
      error: () => undefined,
    });
    cleanups.push(async () => {
      await groups.stop();
      data.store.database.close();
    });
    const { base } = await fixture.start({ groups });
    const token = await fixture.signIn();
    const headers = {
      Authorization: `Bearer ${token}`,
      "OpenBot-Protocol-Version": "3",
      "OpenBot-Capabilities": "group-chats-v1",
      "Content-Type": "application/json",
    };
    expect((await fetch(`${base}/v1/groups`, { headers: { ...headers, "OpenBot-Capabilities": "" } })).status).toBe(
      400,
    );
    expect(
      (await fetch(`${base}/v1/groups`, { headers: { ...headers, Authorization: "Bearer invalid" } })).status,
    ).toBe(401);
    const create = await fetch(`${base}/v1/groups/commands`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "save",
        operationId: "create",
        groupId: "group-1",
        draft: { name: "Project", purpose: "Work together", members: [], leadAgentId: null, linkedThreadIds: [] },
      }),
    });
    expect(create.status).toBe(200);
    const send = await fetch(`${base}/v1/groups/commands`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "send",
        operationId: "send",
        groupId: "group-1",
        text: "Hello",
        recipientAgentId: null,
        replyToMessageId: null,
        attachmentDraftIds: [],
        author: { id: "impostor", name: "Impostor" },
      }),
    });
    expect(send.status).toBe(200);
    const read = await fetch(`${base}/v1/groups/read`, {
      method: "POST",
      headers,
      body: JSON.stringify({ groupId: "group-1" }),
    });
    const page = decodeGroupPage(await read.json());
    expect(page.messages[0]?.author.id).not.toBe("impostor");
    expect(page.messages[0]?.author.kind).toBe("member");
    const legacy = await createTeamApiFixture("no-groups");
    const old = await legacy.start();
    const compatibility = await fetch(`${old.base}/v1/compatibility`);
    expect(await compatibility.json()).toMatchObject({ capabilities: expect.not.arrayContaining(["group-chats-v1"]) });
  });
});
