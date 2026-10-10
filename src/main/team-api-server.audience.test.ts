import {
  CHANNEL_AUDIENCE_CAPABILITY,
  type ChannelAudienceInput,
  decodeChannelAudienceReceipt,
  decodeChannelAudienceResult,
  decodeChannelPage,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { CHANNEL_AUDIENCE_ROUTES } from "@openbot/contracts/team-protocol/channels-audience-v1";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { MCP_SIGN_IN_CAPABILITY } from "@openbot/contracts/team-protocol/mcp-sign-in-v1";
import { TEAM_PI_MUSE_CAPABILITY } from "@openbot/contracts/team-protocol/v7";
import { type TeamApiRequest, teamChannelsApi } from "@openbot/team-client/team-api-requests";
import { Effect } from "effect";
import { afterEach, expect, it } from "vitest";
import { stores } from "../backend/agent-service-test-harness";
import { ChannelService } from "../backend/channel-service";
import { createTeamApiFixture, stopTeamApiFixtures } from "./team-api-server-test-harness";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await stopTeamApiFixtures();
  for (const close of cleanups.splice(0)) await close();
});

it("audience HTTP dispatch authenticates, isolates receipts and projects old/new reads through each registered protocol", async () => {
  const fixture = await createTeamApiFixture("audience", { configure: true });
  const data = stores(fixture.root);
  await Effect.runPromise(data.store.initialize());
  await Effect.runPromise(data.mailbox.initialize());
  for (const id of ["a", "b"]) await Effect.runPromise(data.store.getOrCreate(id));
  const channels = new ChannelService(data.store.database, data.mailbox, {
    agents: () => data.store.list(),
    busy: () => true,
    schedule: () => undefined,
    changed: () => undefined,
    interrupt: () => Effect.void,
    generate: () => Effect.succeed(""),
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
    "Content-Type": "application/json",
    "OpenBot-Capabilities": "channel-chats-v1,channel-audience-v1",
  };
  const post = (path: string, input: unknown, overrides: Record<string, string> = {}) =>
    fetch(`${base}${path}`, { method: "POST", headers: { ...headers, ...overrides }, body: JSON.stringify(input) });
  await Effect.runPromise(
    channels.command(
      {
        type: "save",
        operationId: "create",
        channelId: "room",
        draft: {
          name: "Room",
          title: "",
          instructions: "",
          members: [{ agentId: "a" }, { agentId: "b" }],
          leadAgentId: "a",
        },
      },
      { id: "owner", name: "Owner" },
    ),
  );
  const input: ChannelAudienceInput = {
    channelId: "room",
    operationId: "send",
    text: "Review",
    audience: { kind: "members", agentIds: ["b", "a"] },
    replyToMessageId: null,
    attachmentDraftIds: [],
  };
  expect((await post(CHANNEL_AUDIENCE_ROUTES.command, input, { Authorization: "Bearer invalid" })).status).toBe(401);
  expect(
    (await post(CHANNEL_AUDIENCE_ROUTES.command, input, { "OpenBot-Capabilities": "channel-chats-v1" })).status,
  ).toBe(400);
  const rejected = await post(CHANNEL_AUDIENCE_ROUTES.command, {
    ...input,
    operationId: "refused",
    audience: { kind: "members", agentIds: ["a", "outsider"] },
  });
  expect(rejected.status).toBe(200);
  const refusal = decodeChannelAudienceResult(await rejected.json());
  expect(refusal).toEqual({ status: "not-accepted", channelId: "room", operationId: "refused", reason: "validation" });
  expect(await (await post(CHANNEL_AUDIENCE_ROUTES.command, { ...input, operationId: "refused" })).json()).toEqual(
    refusal,
  );
  expect(channels.store.tasks("room")).toEqual([]);
  const result = await post(CHANNEL_AUDIENCE_ROUTES.command, { ...input, author: { id: "impostor" } });
  expect(result.status).toBe(200);
  const receipt = decodeChannelAudienceReceipt(await result.json());
  expect(receipt.targets.map((target) => target.agentId)).toEqual(["b", "a"]);
  expect(channels.store.page("room").messages[0]?.author.id).not.toBe("impostor");
  expect(
    await (
      await post(CHANNEL_AUDIENCE_ROUTES.command, { ...input, audience: { kind: "all" }, text: "Changed retry" })
    ).json(),
  ).toEqual(receipt);
  for (const version of [1, 2, 3, 4, 5, 6, 7]) {
    const protocol = { "OpenBot-Protocol-Version": String(version) };
    const compatibility = await fetch(`${base}${TEAM_API_ROUTES.compatibility}`, { headers: protocol });
    expect(compatibility.status).toBe(200);
    const support = await compatibility.json();
    expect(support.capabilities).toContain(CHANNEL_AUDIENCE_CAPABILITY);
    expect(support.capabilities.includes(TEAM_PI_MUSE_CAPABILITY)).toBe(version >= 7);
    expect(support.capabilities).not.toContain(MCP_SIGN_IN_CAPABILITY);
    expect(
      decodeChannelAudienceResult(
        await (await post(CHANNEL_AUDIENCE_ROUTES.receipt, { ...input, operationId: "refused" }, protocol)).json(),
      ),
    ).toEqual(refusal);
    expect(
      decodeChannelAudienceResult(
        await (await post(CHANNEL_AUDIENCE_ROUTES.command, { ...input, operationId: "refused" }, protocol)).json(),
      ),
    ).toEqual(refusal);
    const current = decodeChannelPage(
      await (await post(CHANNEL_AUDIENCE_ROUTES.read, { channelId: "room" }, protocol)).json(),
    );
    expect(current.messages[0]?.audience).toEqual(receipt.targets);
    const released = await (await post(CHANNEL_ROUTES.read, { channelId: "room" }, protocol)).json();
    expect(JSON.stringify(released)).not.toContain('"audience"');
    expect(
      await (await post(CHANNEL_AUDIENCE_ROUTES.receipt, { channelId: "room", operationId: "send" }, protocol)).json(),
    ).toEqual(receipt);
  }
  const clientCalls: string[] = [];
  const clientRequest: TeamApiRequest = async (method, path, decode, body) => {
    expect(method).toBe("POST");
    clientCalls.push(path);
    return decode(await (await post(path, body)).json());
  };
  const newClient = teamChannelsApi(clientRequest, () => true);
  expect(await newClient.channelAudienceCommand(input)).toEqual(receipt);
  expect((await newClient.readChannel({ channelId: "room" })).messages[0]?.audience).toEqual(receipt.targets);
  expect(await newClient.channelAudienceReceipt(input)).toEqual(receipt);
  expect(clientCalls).toEqual([
    CHANNEL_AUDIENCE_ROUTES.command,
    CHANNEL_AUDIENCE_ROUTES.read,
    CHANNEL_AUDIENCE_ROUTES.receipt,
  ]);
  const oldClient = teamChannelsApi(clientRequest);
  await expect(oldClient.channelAudienceCommand(input)).rejects.toThrow("does not support");
  expect(clientCalls).toHaveLength(3);
  const invite = await Effect.runPromise(fixture.store.createInvite("member"));
  const member = await Effect.runPromise(fixture.store.acceptInvite(invite.token, "Reader", "member password"));
  expect(
    await (
      await post(CHANNEL_AUDIENCE_ROUTES.receipt, input, { Authorization: `Bearer ${member.sessionToken}` })
    ).json(),
  ).toBeNull();
  expect(await (await post(CHANNEL_AUDIENCE_ROUTES.receipt, { ...input, channelId: "other-room" })).json()).toBeNull();
  expect(channels.store.page("room").messages).toHaveLength(1);
  expect(channels.store.tasks("room")).toHaveLength(2);
});
