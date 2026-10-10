import { expect, it } from "vitest";
import { channelAudienceSelection } from "../channel-audience-selection";
import {
  decodeChannelAudienceReceipt,
  decodeChannelAudienceResult,
  decodeOptionalChannelAudienceResult,
  parseChannelAudienceInput,
} from "../ipc-chat-channels";
import { CHANNEL_AUDIENCE_ROUTES, channelAudienceRequest, channelAudienceResponse } from "./channels-audience-v1";
import { teamSideRouteCodec } from "./side-routes";

const input = {
  operationId: "operation",
  channelId: "room",
  text: "Review",
  audience: { kind: "members", agentIds: ["a", "b"] },
  replyToMessageId: null,
  attachmentDraftIds: [],
};
it("audience boundary strips caller metadata and rejects malformed/duplicate/unbounded selectors in local and side requests", () => {
  expect(
    channelAudienceRequest(CHANNEL_AUDIENCE_ROUTES.command, {
      ...input,
      author: "forged",
      targets: [{ taskId: "forged" }],
    }),
  ).toEqual(input);
  expect(parseChannelAudienceInput({ ...input, targets: "forged" })).toEqual(input);
  for (const audience of [
    { kind: "members", agentIds: [] },
    { kind: "members", agentIds: ["a", "a"] },
    { kind: "members", agentIds: Array.from({ length: 101 }, (_, index) => `member-${index}`) },
    { kind: "members", agentIds: [1] },
    { kind: "other" },
  ]) {
    expect(() => parseChannelAudienceInput({ ...input, audience })).toThrow();
    expect(() => channelAudienceRequest(CHANNEL_AUDIENCE_ROUTES.command, { ...input, audience })).toThrow();
  }
  expect(teamSideRouteCodec(CHANNEL_AUDIENCE_ROUTES.receipt)?.request(CHANNEL_AUDIENCE_ROUTES.receipt, input)).toEqual({
    operationId: "operation",
    channelId: "room",
  });
  expect(channelAudienceResponse(CHANNEL_AUDIENCE_ROUTES.receipt, 200, null)).toBeNull();
  expect(() => channelAudienceResponse(CHANNEL_AUDIENCE_ROUTES.command, 200, null)).toThrow();
  for (const targets of [
    [],
    [
      { agentId: "a", taskId: "same" },
      { agentId: "b", taskId: "same" },
    ],
    [{ agentId: "a", taskId: "" }],
  ]) {
    expect(() => decodeChannelAudienceReceipt({ requestMessageId: "request", targets })).toThrow();
    expect(() =>
      channelAudienceResponse(CHANNEL_AUDIENCE_ROUTES.receipt, 200, { requestMessageId: "request", targets }),
    ).toThrow();
  }
});
it("audience selection has one bounded leading cluster and channel-only all semantics", () => {
  expect(channelAudienceSelection(" @[B](agent:b) @[A](agent:a) @[B](agent:b) Review @[C](agent:c)")).toEqual({
    kind: "members",
    agentIds: ["b", "a"],
  });
  for (const text of ["Ask @[A](agent:a)", "> @[A](agent:a)", "`@[A](agent:a)`", "Mention @all", "@alligator Review"])
    expect(channelAudienceSelection(text)).toBeNull();
  expect(channelAudienceSelection("@all Review")).toEqual({ kind: "all" });
});

it("terminal audience refusal is scoped, bounded and explicit; generic errors and receipt misses do not settle it", () => {
  const refused = { status: "not-accepted", reason: "validation", channelId: "room", operationId: "operation" };
  for (const path of [CHANNEL_AUDIENCE_ROUTES.command, CHANNEL_AUDIENCE_ROUTES.receipt]) {
    expect(
      decodeChannelAudienceResult(channelAudienceResponse(path, 200, { ...refused, sourcePath: "private" })),
    ).toEqual(refused);
    for (const invalid of [
      { ...refused, reason: "transport" },
      { ...refused, status: "unknown" },
      { ...refused, channelId: "" },
      { ...refused, operationId: "x".repeat(129) },
    ]) {
      expect(() => decodeChannelAudienceResult(invalid)).toThrow();
      expect(() => channelAudienceResponse(path, 200, invalid)).toThrow();
    }
    expect(() => decodeChannelAudienceResult(channelAudienceResponse(path, 400, { error: "Not accepted" }))).toThrow();
  }
  expect(decodeOptionalChannelAudienceResult(null)).toBeNull();
});
