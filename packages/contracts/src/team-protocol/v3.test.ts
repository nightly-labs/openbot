import { describe, expect, it } from "vitest";
import {
  analyticsRange,
  assertAnalyticsScope,
  emptyAnalyticsTotals,
  parseAgentAnalyticsInput,
} from "../ipc-agent-analytics";
import { assertHostAnalyticsScope, decodeHostAnalytics, parseHostAnalyticsInput } from "../ipc-host-analytics";
import {
  TEAM_AGENT_ACTIVITY_CAPABILITY,
  TEAM_CURRENT_CAPABILITIES,
  TEAM_EML_ATTACHMENTS_CAPABILITY,
  TEAM_MEDIA_ATTACHMENTS_CAPABILITY,
  TEAM_MODEL_SCOPED_USAGE_CAPABILITY,
} from "./current";
import requestFixture from "./fixtures/v3/client-http-request.json";
import responseFixture from "./fixtures/v3/host-http-response.json";
import profileResponseFixture from "./fixtures/v3/profile-host-response.json";
import {
  decodeTeamProtocolV1HttpRequest,
  highestCommonTeamProtocol,
  TEAM_PROTOCOL_V1_CAPABILITIES,
  teamProtocolUpdateDirection,
} from "./v1";
import { TEAM_PROTOCOL_V3_CAPABILITIES } from "./v3";
import {
  decodeTeamProtocolV3CurrentHttpRequest,
  decodeTeamProtocolV3CurrentHttpResponse,
  encodeTeamProtocolV3CurrentHttpRequest,
  encodeTeamProtocolV3CurrentHttpResponse,
} from "./v3-adapter";
import {
  decodeTeamProtocolV3WebRtcHttpResponse,
  encodeTeamProtocolV3WebRtcHttpRequest,
  encodeTeamProtocolV3WebRtcHttpResponse,
} from "./v3-webrtc-adapter";

const duplicatePath = "/v1/agents/bot-source/duplicate";
/**
 * The wire fixture stays byte-identical; only its current-shaped twin moves. The wire says `bot`, in-app
 * that is `agent`. `marketplaceSource.agentId` runs the other way: on the wire it names a marketplace
 * listing, which in-app is `listingId`. A current-facing decode must return both new spellings and a
 * current-shaped encode must put both wire spellings back. This asymmetry is the evidence the vocabulary
 * shim runs on the v3 duplicate route.
 */
const { bot, ...responseRest } = responseFixture;
const currentResponseFixture = {
  ...responseRest,
  agent: {
    ...bot,
    marketplaceSource: {
      listingId: bot.marketplaceSource.agentId,
      versionId: bot.marketplaceSource.versionId,
      version: bot.marketplaceSource.version,
      skillIds: bot.marketplaceSource.skillIds,
      routineIds: bot.marketplaceSource.routineIds,
    },
  },
};
const scopedUsagePath = "/v1/agents/bot-source/usage";

describe("Team protocol v3", () => {
  it("validates host analytics across HTTP and WebRTC without changing agent analytics", () => {
    const path = "/v1/analytics";
    const input = { startDate: "2026-09-01", endDate: "2026-09-07", timeZone: "UTC" };
    const value = {
      ...input,
      collectionStartedAt: "2026-09-01T00:00:00Z",
      updatedAt: null,
      totals: emptyAnalyticsTotals(),
      daily: [],
      models: [],
      agents: [{ ...emptyAnalyticsTotals(), agentId: "agent-a", share: 1 }],
      providerDaily: [{ date: "2026-09-01", provider: "codex", processedTokens: 10, estimatedCostUsd: 0.5 }],
    };
    expect(TEAM_CURRENT_CAPABILITIES).toContain("host-analytics");
    expect(TEAM_PROTOCOL_V3_CAPABILITIES).not.toContain("host-analytics");
    expect(parseHostAnalyticsInput(input)).toEqual(input);
    expect(() => parseHostAnalyticsInput({ ...input, agentId: "" })).toThrow("agent filter");
    expect(() => parseHostAnalyticsInput({ ...input, timeZone: "invalid" })).toThrow("time zone");
    expect(() => assertHostAnalyticsScope({ ...value, agentId: "a" }, input)).toThrow("does not match");
    expect(encodeTeamProtocolV3WebRtcHttpRequest("GET", path, {})).toEqual({});
    expect(JSON.parse(encodeTeamProtocolV3CurrentHttpResponse("GET", path, 200, value))).toEqual(value);
    expect(decodeTeamProtocolV3WebRtcHttpResponse("GET", path, 200, value)).toEqual(value);
    expect(() =>
      decodeTeamProtocolV3CurrentHttpResponse("GET", path, 200, {
        ...value,
        totals: { ...value.totals, sessions: -1 },
      }),
    ).toThrow("number");
    expect(() =>
      decodeTeamProtocolV3CurrentHttpResponse("GET", path, 200, {
        ...value,
        agents: [{ ...emptyAnalyticsTotals(), agentId: "agent-a", share: 2 }],
      }),
    ).toThrow("share");
    // Both host-only arrays are required, so a host that omits one fails closed rather than
    // reaching the renderer as an empty table or a chart with no series.
    expect(() => decodeHostAnalytics({ ...value, agents: undefined })).toThrow();
    expect(() => decodeHostAnalytics({ ...value, providerDaily: undefined })).toThrow();
    // A cell's date is a calendar date, not any string the wire happens to carry, because
    // the chart joins it to the daily rows by exact value.
    expect(() =>
      decodeHostAnalytics({
        ...value,
        providerDaily: [{ ...value.providerDaily[0], date: "2026-9-1" }],
      }),
    ).toThrow("date");
    expect(
      decodeTeamProtocolV3CurrentHttpResponse("GET", path, 200, { ...value, prompt: "private" }),
    ).not.toHaveProperty("prompt");
  });
  it("adds validated analytics without changing released adapters", () => {
    const path = "/v1/agents/agent-a/analytics?startDate=2026-09-01&endDate=2026-09-07&timeZone=UTC";
    const value = {
      ...analyticsRange("agent-a"),
      collectionStartedAt: "2026-09-01T00:00:00Z",
      updatedAt: null,
      totals: emptyAnalyticsTotals(),
      daily: [],
      models: [],
    };
    expect(TEAM_CURRENT_CAPABILITIES).toContain("agent-analytics");
    expect(() => assertAnalyticsScope({ ...value, agentId: "another-agent" }, value)).toThrow("does not match");
    expect(() => assertAnalyticsScope({ ...value, endDate: "2026-01-01" }, value)).toThrow("does not match");
    expect(() => parseAgentAnalyticsInput({ ...value, timeZone: "invalid" })).toThrow("time zone");
    expect(() => parseAgentAnalyticsInput({ ...value, agentId: "" })).toThrow("request");
    expect(TEAM_PROTOCOL_V3_CAPABILITIES).not.toContain("agent-analytics");
    expect(encodeTeamProtocolV3WebRtcHttpRequest("GET", path, {})).toEqual({});
    expect(JSON.parse(encodeTeamProtocolV3CurrentHttpResponse("GET", path, 200, value))).toEqual(value);
    expect(decodeTeamProtocolV3WebRtcHttpResponse("GET", path, 200, value)).toEqual(value);
    expect(() => decodeTeamProtocolV1HttpRequest("GET", path, {})).toThrow();
    expect(() =>
      decodeTeamProtocolV3CurrentHttpResponse("GET", path, 200, { ...value, totals: { ...value.totals, output: -1 } }),
    ).toThrow("Invalid analytics number");
    expect(
      decodeTeamProtocolV3CurrentHttpResponse("GET", path, 200, { ...value, prompt: "private" }),
    ).not.toHaveProperty("prompt");
  });
  it("adds explicit mark-unread without changing the frozen read operation", () => {
    const path = "/v1/agents/bot-source/conversation/unread";
    const state = { unreadCount: 2, firstUnreadMessageId: "first-reply", throughMessageId: null };
    expect(TEAM_CURRENT_CAPABILITIES).toContain("conversation-unread");
    expect(TEAM_PROTOCOL_V3_CAPABILITIES).not.toContain("conversation-unread");
    expect(encodeTeamProtocolV3WebRtcHttpRequest("POST", path, {})).toEqual({});
    expect(decodeTeamProtocolV3CurrentHttpRequest("POST", path, {})).toEqual({});
    expect(JSON.parse(encodeTeamProtocolV3CurrentHttpResponse("POST", path, 200, state))).toEqual(state);
    expect(decodeTeamProtocolV3WebRtcHttpResponse("POST", path, 200, state)).toEqual(state);
    expect(() => encodeTeamProtocolV3WebRtcHttpRequest("POST", path, { memberId: "another-member" })).toThrow(
      "Invalid conversation-unread request.",
    );
    expect(() => decodeTeamProtocolV1HttpRequest("POST", path, {})).toThrow();
    expect(decodeTeamProtocolV1HttpRequest("POST", path.replace("unread", "read"), { throughMessageId: null })).toEqual(
      { throughMessageId: null },
    );
  });
  it("keeps the duplicate request and response fixtures valid in both adapter directions", () => {
    expect(decodeTeamProtocolV3CurrentHttpRequest("POST", duplicatePath, requestFixture)).toEqual(requestFixture);
    expect(JSON.parse(encodeTeamProtocolV3CurrentHttpRequest("POST", duplicatePath, requestFixture))).toEqual(
      requestFixture,
    );
    expect(decodeTeamProtocolV3CurrentHttpResponse("POST", duplicatePath, 201, responseFixture)).toEqual(
      currentResponseFixture,
    );
    expect(
      JSON.parse(encodeTeamProtocolV3CurrentHttpResponse("POST", duplicatePath, 201, currentResponseFixture)),
    ).toEqual(responseFixture);
    // Every other route delegates to the v1 adapter, and that branch has to come back current-shaped too:
    // the handler reading this one says `ownerAgentId`, so the wire spelling would lose the tab's owner
    // without anything throwing.
    expect(
      decodeTeamProtocolV3CurrentHttpRequest("POST", "/v1/browser/open", {
        url: "https://example.com/",
        ownerThreadId: "thread-1",
        ownerBotId: "chief",
        focus: true,
      }),
    ).toEqual({ url: "https://example.com/", ownerThreadId: "thread-1", ownerAgentId: "chief", focus: true });
  });

  it("requires a valid idempotency key for duplicate requests", () => {
    expect(() => decodeTeamProtocolV3CurrentHttpRequest("POST", duplicatePath, {})).toThrow(
      "Invalid Team protocol v3 duplicate-agent request.",
    );
    expect(() => decodeTeamProtocolV3CurrentHttpRequest("POST", duplicatePath, { operationId: "not-a-uuid" })).toThrow(
      "Invalid Team protocol v3 duplicate-agent request.",
    );
  });

  it("keeps old protocols frozen without the duplication route or capability", () => {
    expect(() => decodeTeamProtocolV1HttpRequest("POST", duplicatePath, requestFixture)).toThrow(
      "Invalid Team protocol v1 HTTP request",
    );
    expect(TEAM_PROTOCOL_V1_CAPABILITIES).not.toContain("agent-duplication");
    expect(TEAM_PROTOCOL_V1_CAPABILITIES).toContain("hosted-site-event-markers");
    expect(TEAM_PROTOCOL_V3_CAPABILITIES).toContain("agent-duplication");
    expect(TEAM_PROTOCOL_V3_CAPABILITIES).toContain("hosted-site-event-markers");
    expect(TEAM_PROTOCOL_V1_CAPABILITIES).not.toContain(TEAM_AGENT_ACTIVITY_CAPABILITY);
    expect(TEAM_PROTOCOL_V3_CAPABILITIES).not.toContain(TEAM_AGENT_ACTIVITY_CAPABILITY);
    expect(TEAM_CURRENT_CAPABILITIES).toContain(TEAM_AGENT_ACTIVITY_CAPABILITY);
    expect(TEAM_PROTOCOL_V1_CAPABILITIES).not.toContain(TEAM_MODEL_SCOPED_USAGE_CAPABILITY);
    expect(TEAM_PROTOCOL_V3_CAPABILITIES).not.toContain(TEAM_MODEL_SCOPED_USAGE_CAPABILITY);
    expect(TEAM_CURRENT_CAPABILITIES).toContain(TEAM_MODEL_SCOPED_USAGE_CAPABILITY);
    expect(TEAM_PROTOCOL_V1_CAPABILITIES).not.toContain(TEAM_EML_ATTACHMENTS_CAPABILITY);
    expect(TEAM_PROTOCOL_V3_CAPABILITIES).not.toContain(TEAM_EML_ATTACHMENTS_CAPABILITY);
    expect(TEAM_CURRENT_CAPABILITIES).toContain(TEAM_EML_ATTACHMENTS_CAPABILITY);
    expect(TEAM_PROTOCOL_V1_CAPABILITIES).not.toContain(TEAM_MEDIA_ATTACHMENTS_CAPABILITY);
    expect(TEAM_PROTOCOL_V3_CAPABILITIES).not.toContain(TEAM_MEDIA_ATTACHMENTS_CAPABILITY);
    expect(TEAM_CURRENT_CAPABILITIES).toContain(TEAM_MEDIA_ATTACHMENTS_CAPABILITY);
  });

  it("adds model-scoped usage only to the current adapter", () => {
    const usage = {
      limits: [
        {
          id: "claude",
          primary: null,
          secondary: { usedPercent: 37, windowDurationMins: 10_080, resetsAt: 1_788_825_600 },
        },
      ],
    };
    expect(decodeTeamProtocolV3CurrentHttpRequest("GET", scopedUsagePath, {})).toEqual({});
    expect(JSON.parse(encodeTeamProtocolV3CurrentHttpResponse("GET", scopedUsagePath, 200, usage))).toEqual(usage);
    expect(() => decodeTeamProtocolV1HttpRequest("GET", scopedUsagePath, {})).toThrow(
      "Invalid Team protocol v1 HTTP request",
    );
  });

  it("registers the v3 route on the WebRTC adapter", () => {
    expect(encodeTeamProtocolV3WebRtcHttpRequest("POST", duplicatePath, requestFixture)).toEqual(requestFixture);
    expect(decodeTeamProtocolV3WebRtcHttpResponse("POST", duplicatePath, 201, responseFixture)).toEqual(
      currentResponseFixture,
    );
    // The direction the decode assertion above cannot see. What this peer sends has to leave in the frozen
    // vocabulary: a response spelled `agent` is one the receiving peer's frozen codec rejects outright, and
    // no already-shipped client would understand it either.
    expect(encodeTeamProtocolV3WebRtcHttpResponse("POST", duplicatePath, 201, currentResponseFixture)).toEqual(
      responseFixture,
    );
    expect(encodeTeamProtocolV3WebRtcHttpRequest("GET", scopedUsagePath, undefined)).toEqual({});
    expect(
      decodeTeamProtocolV3WebRtcHttpResponse("GET", scopedUsagePath, 200, {
        limits: [{ id: "claude", primary: null, secondary: null }],
      }),
    ).toEqual({ limits: [{ id: "claude", primary: null, secondary: null }] });
  });

  it("reports both update directions when no common protocol exists", () => {
    expect(highestCommonTeamProtocol({ minimum: 1, maximum: 2 }, { minimum: 3, maximum: 3 })).toBeNull();
    expect(teamProtocolUpdateDirection({ minimum: 1, maximum: 2 }, { minimum: 3, maximum: 3 })).toBe(
      "client_update_required",
    );
    expect(teamProtocolUpdateDirection({ minimum: 3, maximum: 3 }, { minimum: 1, maximum: 2 })).toBe(
      "host_update_required",
    );
  });
});

it("round trips reviewed profiles through the additive v3 HTTP and WebRTC routes", async () => {
  const {
    encodeTeamProtocolV3CurrentHttpRequest,
    decodeTeamProtocolV3CurrentHttpRequest,
    encodeTeamProtocolV3CurrentHttpResponse,
    decodeTeamProtocolV3CurrentHttpResponse,
  } = await import("./v3-adapter");
  const { encodeTeamProtocolV3WebRtcHttpRequest, decodeTeamProtocolV3WebRtcHttpRequest } = await import(
    "./v3-webrtc-adapter"
  );
  const draft = {
    name: "Researcher",
    title: "Science",
    description: "Cite sources",
    avatarSeed: "research",
    avatarHue: 215,
    sectionId: null,
  };
  const path = "/v1/agents/profile/generate";
  const input = { prompt: "Research science", agentId: "chief", draft };
  const encoded = encodeTeamProtocolV3CurrentHttpRequest("POST", path, input);
  expect(decodeTeamProtocolV3CurrentHttpRequest("POST", path, JSON.parse(encoded))).toEqual(input);
  expect(
    decodeTeamProtocolV3WebRtcHttpRequest("POST", path, encodeTeamProtocolV3WebRtcHttpRequest("POST", path, input)),
  ).toEqual(input);
  const incomplete = { ...input, draft: { ...draft, name: "", description: "" } };
  expect(
    decodeTeamProtocolV3CurrentHttpRequest(
      "POST",
      path,
      JSON.parse(encodeTeamProtocolV3CurrentHttpRequest("POST", path, incomplete)),
    ),
  ).toEqual(incomplete);
  expect(
    decodeTeamProtocolV3WebRtcHttpRequest(
      "POST",
      path,
      encodeTeamProtocolV3WebRtcHttpRequest("POST", path, incomplete),
    ),
  ).toEqual(incomplete);
  expect(() =>
    encodeTeamProtocolV3CurrentHttpRequest("POST", path, {
      ...incomplete,
      draft: { ...incomplete.draft, description: "x".repeat(2001) },
    }),
  ).toThrow();
  expect(() => decodeTeamProtocolV3CurrentHttpResponse("POST", path, 200, incomplete.draft)).toThrow();
  const response = encodeTeamProtocolV3CurrentHttpResponse("POST", path, 200, draft);
  expect(decodeTeamProtocolV3CurrentHttpResponse("POST", path, 200, JSON.parse(response))).toEqual(draft);
  expect(() => decodeTeamProtocolV3CurrentHttpResponse("POST", path, 200, { ...draft, avatarHue: 20 })).toThrow();
  expect(() => encodeTeamProtocolV3CurrentHttpRequest("POST", path, { prompt: "" })).toThrow();
});

it("rejects invalid reviewed saves at the protocol boundary", async () => {
  const { parseSaveAgentProfile } = await import("../ipc-agent-profile");
  const input = {
    operationId: "ef3cfb5c-d0e9-49bf-b5b1-66ac21415339",
    initialMessage: "Hello",
    draft: {
      name: "Researcher",
      title: "Science",
      description: "Cite sources",
      avatarSeed: "research",
      avatarHue: 215,
      sectionId: null,
    },
  };
  expect(parseSaveAgentProfile(input)).toEqual(input);
  for (const invalid of [
    { ...input, operationId: "invalid" },
    { ...input, initialMessage: "" },
    { ...input, draft: { ...input.draft, name: "" } },
    { ...input, draft: { ...input.draft, description: "" } },
    { ...input, draft: { ...input.draft, avatarSeed: "../avatar.png" } },
  ]) {
    expect(() => parseSaveAgentProfile(invalid)).toThrow("valid reviewed profile");
  }
});

it("keeps profile save responses frozen across HTTP and WebRTC adapters", () => {
  const path = "/v1/agents/profile/save";
  const current = { ...currentResponseFixture, agent: { ...currentResponseFixture.agent, futureIpcField: "private" } };
  expect(JSON.parse(encodeTeamProtocolV3CurrentHttpResponse("POST", path, 200, current))).toEqual(
    profileResponseFixture,
  );
  expect(encodeTeamProtocolV3WebRtcHttpResponse("POST", path, 200, current)).toEqual(profileResponseFixture);
  expect(decodeTeamProtocolV3CurrentHttpResponse("POST", path, 200, profileResponseFixture)).toEqual(
    currentResponseFixture,
  );
  expect(decodeTeamProtocolV3WebRtcHttpResponse("POST", path, 200, profileResponseFixture)).toEqual(
    currentResponseFixture,
  );
});
// v3 delegates every non-duplicate route to v1, and the duplicate route wraps a v1 bot summary.
// Both halves keep the three-id vocabulary: a fourth provider is v4's, and this is what stops a
// later change from widening v3 in passing.
it("freezes the v3 provider vocabulary", () => {
  const agent = {
    id: "agent-1",
    provider: "codex",
    name: "Chief",
    title: "Chief of staff",
    description: "",
    notifications: true,
    model: "gpt-5.6-luna",
    reasoningEffort: "medium",
    threadId: null,
    workspacePath: "/Users/dev/OpenBot/Agents/agent-1",
    preview: "",
    updatedAt: null,
    avatarSeed: "first-bot",
    avatarHue: null,
    avatarUrl: null,
  };
  const layout = { revision: 1, sections: [], order: [], agentAssignments: {}, agentOrder: [] };

  expect(decodeTeamProtocolV3CurrentHttpResponse("GET", "/v1/agents", 200, [agent])).toEqual([agent]);
  expect(decodeTeamProtocolV3CurrentHttpResponse("POST", duplicatePath, 201, { bot: agent, layout })).toEqual({
    agent,
    layout,
  });

  expect(() =>
    decodeTeamProtocolV3CurrentHttpResponse("GET", "/v1/agents", 200, [{ ...agent, provider: "opencode" }]),
  ).toThrow("Invalid Team protocol v1 HTTP response");
  expect(() =>
    decodeTeamProtocolV3CurrentHttpResponse("POST", duplicatePath, 201, {
      bot: { ...agent, provider: "opencode" },
      layout,
    }),
  ).toThrow("Invalid Team protocol v1 HTTP response");
  expect(() => decodeTeamProtocolV3CurrentHttpRequest("PATCH", "/v1/agents/agent-1", { provider: "opencode" })).toThrow(
    "Invalid Team protocol v1 HTTP request",
  );
});

it("carries queue drafts over WebRTC and rejects malformed attachment data", () => {
  const path = "/v1/agents/chief/queue/take";
  expect(encodeTeamProtocolV3WebRtcHttpRequest("POST", path, { deliveryId: "delivery" })).toEqual({
    deliveryId: "delivery",
  });
  const draft = {
    text: "Edited later",
    attachments: [
      {
        id: "draft-file",
        name: "notes.txt",
        size: 5,
        kind: "file",
        mimeType: "text/plain",
        previewKind: "none",
        previewUrl: null,
      },
    ],
  };
  const wire = encodeTeamProtocolV3WebRtcHttpResponse("POST", path, 200, draft);
  expect(decodeTeamProtocolV3WebRtcHttpResponse("POST", path, 200, wire)).toEqual(draft);
  expect(() => decodeTeamProtocolV3WebRtcHttpResponse("POST", path, 200, { text: "Draft", attachments: [{}] })).toThrow(
    "Invalid queued message draft.",
  );
});

it("carries durable edits over WebRTC and rejects invalid revisions", () => {
  const path = "/v1/agents/chief/queue/edit";
  const request = {
    agentId: "chief",
    deliveryId: "delivery",
    operation: "send",
    revision: 2,
    text: "Revised",
    attachmentDraftIds: [],
  };
  expect(encodeTeamProtocolV3WebRtcHttpRequest("POST", path, request)).toEqual(request);
  expect(() => encodeTeamProtocolV3WebRtcHttpRequest("POST", path, { ...request, revision: 0 })).toThrow(
    "Invalid queue edit revision.",
  );
  const state = {
    deliveryId: "delivery",
    revision: 2,
    text: "Saved draft",
    attachments: [],
    replyToMessageId: "reply",
  };
  const wire = encodeTeamProtocolV3WebRtcHttpResponse("POST", path, 200, state);
  expect(decodeTeamProtocolV3WebRtcHttpResponse("POST", path, 200, wire)).toEqual(state);
  expect(decodeTeamProtocolV3WebRtcHttpResponse("POST", path, 200, null)).toBeNull();
  expect(() => decodeTeamProtocolV3WebRtcHttpResponse("POST", path, 200, { ...state, attachments: [{}] })).toThrow(
    "Invalid queue edit state.",
  );
});
