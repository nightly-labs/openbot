import { describe, expect, it } from "vitest";
import { isAgentSummary } from "../ipc-agents";
import { isDynamicRecord } from "../runtime-values";
import { TEAM_API_ROUTES } from "../team-api-routes";
import { browserViewStreamPath } from "./browser-view-v1";
import request from "./fixtures/v4/client-http-request.json";
import response from "./fixtures/v4/host-http-response.json";
import profileResponseFixture from "./fixtures/v4/profile-host-response.json";
import { decodeProfileV4Draft, decodeProfileV4Request, decodeProfileV4Response } from "./profile-v4";
import { encodeTeamProtocolV1CurrentHttpResponse } from "./v1-adapter";
import { decodeTeamProtocolV3CurrentHttpResponse } from "./v3-adapter";
import {
  decodeTeamProtocolV4CurrentHttpRequest,
  decodeTeamProtocolV4CurrentHttpResponse,
  encodeTeamProtocolV4CurrentHttpRequest,
  encodeTeamProtocolV4CurrentHttpResponse,
} from "./v4-adapter";
import { decodeTeamProtocolV4BaseCurrentEvent, encodeTeamProtocolV4BaseCurrentEvent } from "./v4-base-adapter";
import {
  createTeamProtocolV4Event,
  decodeTeamProtocolV4CurrentEvent,
  decodeTeamProtocolV4WebRtcHttpRequest,
  decodeTeamProtocolV4WebRtcHttpResponse,
  encodeTeamProtocolV4WebRtcHttpRequest,
  encodeTeamProtocolV4WebRtcHttpResponse,
} from "./v4-webrtc-adapter";

describe("Team protocol v4", () => {
  it("carries remote desktop setup and test results without changing released routes", () => {
    const setup = {
      platform: "darwin",
      hostName: "Mac mini",
      username: "tenant",
      checkedAt: "2026-09-21T10:00:00.000Z",
      screenRecording: "blocked",
      accessibility: "allowed",
      service: "allowed",
      displays: "unavailable",
      guiSession: "blocked",
      restartRequired: false,
      activeSessions: 0,
      message: null,
    };
    const setupPath = TEAM_API_ROUTES.remoteScreen.setup;
    const testPath = TEAM_API_ROUTES.remoteScreen.test;
    expect(encodeTeamProtocolV4WebRtcHttpRequest("POST", setupPath, {})).toEqual({});
    expect(
      decodeTeamProtocolV4WebRtcHttpResponse(
        "POST",
        setupPath,
        200,
        encodeTeamProtocolV4WebRtcHttpResponse("POST", setupPath, 200, setup),
      ),
    ).toEqual(setup);
    const test = { active: true, mouse: false, keyboard: false, code: "1234" };
    expect(JSON.parse(encodeTeamProtocolV4CurrentHttpResponse("POST", testPath, 200, test))).toEqual(test);
    expect(
      decodeTeamProtocolV4CurrentHttpRequest("POST", testPath, { sessionId: "session-1", action: "start" }),
    ).toEqual({ sessionId: "session-1", action: "start" });
    expect(() =>
      decodeTeamProtocolV4CurrentHttpRequest("POST", testPath, { sessionId: "session-1", action: "approve" }),
    ).toThrow();
    expect(() => decodeTeamProtocolV4CurrentHttpRequest("POST", setupPath, { username: "other-user" })).toThrow();
    expect(() =>
      decodeTeamProtocolV4CurrentHttpResponse("POST", setupPath, 200, { ...setup, accessibility: true }),
    ).toThrow();
    expect(() =>
      decodeTeamProtocolV4CurrentHttpResponse("POST", testPath, 200, { ...test, keyboard: "yes" }),
    ).toThrow();
    expect(() => decodeTeamProtocolV3CurrentHttpResponse("POST", setupPath, 200, setup)).toThrow();
  });

  it("round-trips OpenCode agent and model selection without widening v3", () => {
    expect(decodeTeamProtocolV4CurrentHttpRequest("PATCH", "/v1/agents/agent-opencode", request)).toEqual(request);
    expect(encodeTeamProtocolV4WebRtcHttpRequest("PATCH", "/v1/agents/agent-opencode", request)).toEqual(request);
    expect(JSON.parse(encodeTeamProtocolV4CurrentHttpResponse("GET", "/v1/agents", 200, response))).toEqual(response);
    expect(decodeTeamProtocolV4CurrentHttpResponse("GET", "/v1/agents", 200, response)).toEqual(response);
    expect(() => decodeTeamProtocolV3CurrentHttpResponse("GET", "/v1/agents", 200, response)).toThrow();
    expect(() =>
      decodeTeamProtocolV4CurrentHttpResponse("GET", "/v1/agents", 200, [{ ...response[0], provider: "unknown" }]),
    ).toThrow();
  });

  it("carries an address and the active tab that the frozen browser routes cannot", () => {
    const load = { tabId: "tab-1", url: "https://example.com/next" };
    expect(JSON.parse(encodeTeamProtocolV4CurrentHttpRequest("POST", "/v1/browser/load", load))).toEqual(load);
    expect(decodeTeamProtocolV4CurrentHttpRequest("POST", "/v1/browser/load", load)).toEqual(load);

    // The released navigate route names `direction` only, so the address the user typed is dropped
    // on the way out - which is the whole reason the route above exists.
    expect(
      JSON.parse(
        encodeTeamProtocolV4CurrentHttpRequest("POST", "/v1/browser/navigate", {
          tabId: "tab-1",
          direction: "back",
          url: "https://example.com/next",
        }),
      ),
    ).toEqual({ tabId: "tab-1", direction: "back" });

    const tab = { id: "tab-2", title: "Example", url: "https://example.com", loading: false, ownerThreadId: null };
    const current = { tabs: [{ ...tab, ownerAgentId: "chief" }], activeTabId: "tab-2" };
    const wire = { tabs: [{ ...tab, ownerBotId: "chief" }], activeTabId: "tab-2" };
    // The tab list keeps the released vocabulary, so the owner reaches the wire as `ownerBotId` and
    // comes back as `ownerAgentId`, exactly as it does on `/v1/browser/tabs`.
    expect(JSON.parse(encodeTeamProtocolV4CurrentHttpResponse("GET", "/v1/browser/display", 200, current))).toEqual(
      wire,
    );
    expect(decodeTeamProtocolV4CurrentHttpResponse("GET", "/v1/browser/display", 200, wire)).toEqual(current);
    // The display route is a GET with no body, and the frozen v2 frame cannot name a route added
    // after it, so the WebRTC request frame is empty rather than a classification failure.
    expect(encodeTeamProtocolV4WebRtcHttpRequest("GET", "/v1/browser/display", undefined)).toEqual({});
    expect(() => decodeTeamProtocolV4CurrentHttpResponse("GET", "/v1/browser/display", 200, { tabs: [tab] })).toThrow();
    expect(() => decodeTeamProtocolV4CurrentHttpRequest("POST", "/v1/browser/load", { tabId: "tab-1" })).toThrow();
  });

  it("carries the queue edit mark to a current client and drops it for a frozen one", () => {
    const delivery = {
      id: "delivery-1",
      messageId: "message-1",
      recipientAgentId: "chief",
      sender: { kind: "user" },
      text: "Read the report",
      attachments: [],
      replyToMessageId: null,
      status: "queued",
      position: 1,
      turnId: null,
      error: null,
      createdAt: "2026-09-16T10:00:00.000Z",
      editing: true,
    };
    const snapshot = { agentId: "chief", deliveries: [delivery] };
    const queuePath = "/v1/agents/chief/queue";

    const wire = JSON.parse(encodeTeamProtocolV4CurrentHttpResponse("GET", queuePath, 200, snapshot));
    expect(wire.deliveries[0].editing).toBe(true);
    expect(decodeTeamProtocolV4CurrentHttpResponse("GET", queuePath, 200, wire)).toEqual(snapshot);
    // The queue edit response is the same snapshot, so the holder sees the mark too.
    const edited = JSON.parse(encodeTeamProtocolV4CurrentHttpResponse("POST", `${queuePath}/edit`, 200, snapshot));
    expect(edited.deliveries[0].editing).toBe(true);
    // A direct WebRTC connection carries it too, so a phone on either transport sees the mark.
    const overWebRtc = encodeTeamProtocolV4WebRtcHttpResponse("GET", queuePath, 200, snapshot);
    expect(decodeTeamProtocolV4WebRtcHttpResponse("GET", queuePath, 200, overWebRtc)).toEqual(snapshot);
    // A frozen adapter projects a fixed key list: the mark is absent, not false.
    const frozen = JSON.parse(encodeTeamProtocolV1CurrentHttpResponse("GET", queuePath, 200, snapshot));
    expect(frozen.deliveries[0]).not.toHaveProperty("editing");
  });

  it("carries the exchange reply mark to a current client and drops it for a frozen one", () => {
    const conversationPath = "/v1/agents/chief/conversation";
    const exchange = {
      direction: "incoming",
      messageId: "message-1",
      senderAgentId: "builder",
      recipientAgentIds: ["chief"],
      replyToMessageId: null,
      deliveries: [{ id: "delivery-1", recipientAgentId: "chief", status: "completed", position: null, error: null }],
    };
    const message = {
      id: "notice",
      author: "system",
      text: "",
      createdAt: "2026-09-16T10:00:00.000Z",
      status: "completed",
    };
    // The mark is the only thing that varies, and one case gives it a shape the host never writes.
    const conversation = (...mark: unknown[]) => ({
      agentId: "chief",
      threadId: "thread-1",
      activeTurnId: null,
      revision: 1,
      messages: [{ ...message, exchange: mark.length ? { ...exchange, expectsReply: mark[0] } : exchange }],
      readState: { unreadCount: 0, firstUnreadMessageId: null, throughMessageId: null },
    });
    const marked = conversation(false);

    const wire = JSON.parse(encodeTeamProtocolV4CurrentHttpResponse("GET", conversationPath, 200, marked));
    expect(wire.messages[0].exchange.expectsReply).toBe(false);
    expect(decodeTeamProtocolV4CurrentHttpResponse("GET", conversationPath, 200, wire)).toEqual(marked);
    // A direct WebRTC connection carries it too, so a phone on either transport names the message.
    const overWebRtc = encodeTeamProtocolV4WebRtcHttpResponse("GET", conversationPath, 200, marked);
    expect(decodeTeamProtocolV4WebRtcHttpResponse("GET", conversationPath, 200, overWebRtc)).toEqual(marked);
    // A frozen adapter projects a fixed key list: the mark is absent, so the client reads a request.
    const frozen = JSON.parse(encodeTeamProtocolV1CurrentHttpResponse("GET", conversationPath, 200, marked));
    expect(frozen.messages[0].exchange).not.toHaveProperty("expectsReply");
    // A host that never sends the mark still passes, and still means a request.
    const unmarked = JSON.parse(encodeTeamProtocolV4CurrentHttpResponse("GET", conversationPath, 200, conversation()));
    expect(unmarked.messages[0].exchange).not.toHaveProperty("expectsReply");
    // An unchecked mark would read as an exchange nobody owes an answer for, hiding a waiting
    // teammate. Both directions refuse it rather than project it.
    const malformed = conversation("no");
    expect(() => encodeTeamProtocolV4CurrentHttpResponse("GET", conversationPath, 200, malformed)).toThrow(
      "reply mark",
    );
    expect(() => decodeTeamProtocolV4CurrentHttpResponse("GET", conversationPath, 200, malformed)).toThrow();
  });

  it("rejects a queue snapshot whose edit mark is not a boolean", () => {
    const queuePath = "/v1/agents/chief/queue";
    const delivery = {
      id: "delivery-1",
      messageId: "message-1",
      recipientAgentId: "chief",
      sender: { kind: "user" },
      text: "Read the report",
      attachments: [],
      replyToMessageId: null,
      status: "queued",
      position: 1,
      turnId: null,
      error: null,
      createdAt: "2026-09-16T10:00:00.000Z",
    };
    const snapshot = { agentId: "chief", deliveries: [{ ...delivery, editing: "true" }] };
    // The projection drops the key, so a mark that survived unchecked would read as a message
    // nobody holds. The frozen response validator rejects the snapshot, and the encoder refuses
    // to write one, so neither side turns a malformed mark into an editable row.
    expect(() => decodeTeamProtocolV4CurrentHttpResponse("GET", queuePath, 200, snapshot)).toThrow();
    expect(() => encodeTeamProtocolV4CurrentHttpResponse("GET", queuePath, 200, snapshot)).toThrow("edit mark");
    // A host that never sends the mark still passes.
    const unmarked = { agentId: "chief", deliveries: [delivery] };
    const wire = JSON.parse(encodeTeamProtocolV4CurrentHttpResponse("GET", queuePath, 200, unmarked));
    expect(decodeTeamProtocolV4CurrentHttpResponse("GET", queuePath, 200, wire)).toEqual(unmarked);
  });

  it("carries OpenCode agent events through HTTP events and WebRTC", () => {
    const agent = response[0];
    if (!isAgentSummary(agent)) throw new Error("Invalid v4 fixture.");
    const event = { type: "agents-changed" as const, agents: [agent] };
    const wire = encodeTeamProtocolV4BaseCurrentEvent(event);
    expect(decodeTeamProtocolV4BaseCurrentEvent(JSON.parse(wire ?? "null"))).toEqual({ kind: "known", event });
    expect(decodeTeamProtocolV4CurrentEvent(createTeamProtocolV4Event(1, JSON.parse(wire ?? "null")))).toEqual({
      status: "known",
      event,
    });
  });
});

it.each([encodeTeamProtocolV4WebRtcHttpResponse, decodeTeamProtocolV4WebRtcHttpResponse])(
  "%s accepts successful bodyless deletion responses",
  (adapt) => {
    for (const path of [
      "/v1/agents/agent-1",
      "/v1/agents/agent-1/memories/memory-1",
      "/v1/agents/agent-1/routines/routine-1",
    ]) {
      expect(adapt("DELETE", path, 204, undefined)).toEqual({});
    }
  },
);

it.each([encodeTeamProtocolV4WebRtcHttpRequest, decodeTeamProtocolV4WebRtcHttpRequest])(
  "%s preserves bodyless manual routine runs",
  (adapt) => {
    for (const body of [undefined, null, {}]) {
      expect(adapt("POST", "/v1/agents/agent-1/routines/routine-1/test", body)).toEqual({});
    }
  },
);

it.each([encodeTeamProtocolV4WebRtcHttpRequest, decodeTeamProtocolV4WebRtcHttpRequest])(
  "%s preserves remote-viewer authorization requests",
  (adapt) => {
    expect(adapt("POST", "/v1/remote-screen/sessions/session-1/authorize", { code: "viewer-code" })).toEqual({
      code: "viewer-code",
    });
  },
);

it.each([encodeTeamProtocolV4WebRtcHttpResponse, decodeTeamProtocolV4WebRtcHttpResponse])(
  "%s preserves remote-viewer responses",
  (adapt) => {
    for (const route of ["viewer", "authorize", "viewer-state", "moonlight/api/role"]) {
      const payload = { ready: true };
      expect(
        adapt(route === "authorize" ? "POST" : "GET", `/v1/remote-screen/sessions/session-1/${route}`, 200, payload),
      ).toEqual(payload);
    }
  },
);

// v4 is the first protocol whose agent profile carries a provider v3 cannot spell, and its save
// response is the one place the marketplace key inverts: in-app `listingId` is the wire `agentId`,
// while every other `agentId` means the product agent. Pinning the encoded form is what keeps a
// later edit to `profile-v4.ts` from silently reprojecting either.
it("keeps profile save responses frozen across HTTP and WebRTC adapters", () => {
  const path = "/v1/agents/profile/save";
  const current = decodeTeamProtocolV4CurrentHttpResponse("POST", path, 200, profileResponseFixture);
  expect(JSON.parse(encodeTeamProtocolV4CurrentHttpResponse("POST", path, 200, current))).toEqual(
    profileResponseFixture,
  );
  expect(encodeTeamProtocolV4WebRtcHttpResponse("POST", path, 200, current)).toEqual(profileResponseFixture);
  expect(decodeTeamProtocolV4WebRtcHttpResponse("POST", path, 200, profileResponseFixture)).toEqual(current);
  const agent = isDynamicRecord(current) ? current.agent : null;
  if (!isDynamicRecord(agent)) throw new Error("Invalid v4 profile fixture.");
  expect(agent.marketplaceSource).toEqual({
    listingId: "market-research",
    versionId: "market-research-v2",
    version: 2,
    skillIds: ["primary-sources"],
    routineIds: ["routine-copy"],
  });
});

// The frozen base projection names no provider or model, so the pair rides beside it only behind
// the capability: both directions drop it without the flag, which is the released behavior.
it("carries a chosen provider and model on agent creation only behind the capability", () => {
  const path = "/v1/agents";
  const input = {
    name: "Helper",
    description: "Helps out.",
    avatarSeed: "setup:helper",
    avatarHue: null,
    initialMessage: "Greet me briefly.",
    provider: "opencode",
    model: "opencode/example-model",
    reasoningEffort: "high",
  };
  const wire = JSON.parse(encodeTeamProtocolV4CurrentHttpRequest("POST", path, input, { agentCreateModel: true }));
  expect(wire).toMatchObject({
    name: "Helper",
    provider: "opencode",
    model: "opencode/example-model",
    reasoningEffort: "high",
  });
  expect(decodeTeamProtocolV4CurrentHttpRequest("POST", path, wire, { agentCreateModel: true })).toEqual(input);
  const bare = JSON.parse(encodeTeamProtocolV4CurrentHttpRequest("POST", path, input));
  expect(bare).not.toHaveProperty("provider");
  expect(bare).not.toHaveProperty("model");
  expect(decodeTeamProtocolV4CurrentHttpRequest("POST", path, wire)).toEqual({
    name: "Helper",
    description: "Helps out.",
    avatarSeed: "setup:helper",
    avatarHue: null,
    initialMessage: "Greet me briefly.",
  });
  expect(() =>
    decodeTeamProtocolV4CurrentHttpRequest("POST", path, { ...wire, provider: "unknown" }, { agentCreateModel: true }),
  ).toThrow();
});

// The WebRTC arm runs the same current-layer codec around the frozen v2 framing, so the chosen
// pair needs the flag at both WebRTC calls too — without it the frozen projection drops the
// fields while both peers advertise the capability.
it("carries a chosen provider and model on agent creation through WebRTC only behind the capability", () => {
  const path = "/v1/agents";
  const input = {
    name: "Helper",
    description: "Helps out.",
    avatarSeed: "setup:helper",
    avatarHue: null,
    initialMessage: "Greet me briefly.",
    provider: "opencode",
    model: "opencode/example-model",
    reasoningEffort: "high",
  };
  const wire = encodeTeamProtocolV4WebRtcHttpRequest("POST", path, input, { agentCreateModel: true });
  expect(isDynamicRecord(wire) ? wire.provider : undefined).toBe("opencode");
  expect(decodeTeamProtocolV4WebRtcHttpRequest("POST", path, wire, { agentCreateModel: true })).toEqual(input);
  const bare = encodeTeamProtocolV4WebRtcHttpRequest("POST", path, input);
  expect(isDynamicRecord(bare) && "provider" in bare).toBe(false);
  expect(decodeTeamProtocolV4WebRtcHttpRequest("POST", path, wire)).toEqual({
    name: "Helper",
    description: "Helps out.",
    avatarSeed: "setup:helper",
    avatarHue: null,
    initialMessage: "Greet me briefly.",
  });
});

it("round trips reviewed profiles through the additive v4 HTTP and WebRTC routes", () => {
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
  expect(
    decodeTeamProtocolV4CurrentHttpRequest(
      "POST",
      path,
      JSON.parse(encodeTeamProtocolV4CurrentHttpRequest("POST", path, input)),
    ),
  ).toEqual(input);
  expect(
    decodeTeamProtocolV4WebRtcHttpRequest("POST", path, encodeTeamProtocolV4WebRtcHttpRequest("POST", path, input)),
  ).toEqual(input);
  // A half-written draft is a legal request: the user is still editing it when generation starts.
  const incomplete = { ...input, draft: { ...draft, name: "", description: "" } };
  expect(
    decodeTeamProtocolV4CurrentHttpRequest(
      "POST",
      path,
      JSON.parse(encodeTeamProtocolV4CurrentHttpRequest("POST", path, incomplete)),
    ),
  ).toEqual(incomplete);
  const response = encodeTeamProtocolV4CurrentHttpResponse("POST", path, 200, draft);
  expect(decodeTeamProtocolV4CurrentHttpResponse("POST", path, 200, JSON.parse(response))).toEqual(draft);
});

// Against `profile-v4.ts` and not through an adapter, deliberately. The adapter runs the current IPC
// parser first, so it rejects these inputs before the frozen codec sees them - a bound asserted
// through the adapter passes whatever `profile-v4.ts` says, which is the opposite of freezing it.
// These bounds belong to the v4 wire and must outlive any change to the current profile model.
it("freezes the v4 profile draft bounds independently of the current profile model", () => {
  const draft = {
    name: "Researcher",
    title: "Science",
    description: "Cite sources",
    avatarSeed: "research",
    avatarHue: 215,
    sectionId: null,
  };
  expect(decodeProfileV4Draft(draft, true)).toEqual(draft);
  // The codec projects through its own key list, so a key a later build adds never reaches the wire.
  expect(decodeProfileV4Draft({ ...draft, futureField: "private" }, true)).toEqual(draft);
  // Incomplete is legal while generating, and rejected once the draft is presented as finished.
  const blank = { ...draft, name: "", description: "" };
  expect(decodeProfileV4Draft(blank, false)).toEqual(blank);
  expect(() => decodeProfileV4Draft(blank, true)).toThrow("Invalid profile v4 draft.");
  for (const invalid of [
    { ...draft, description: "x".repeat(2_001) },
    { ...draft, name: "x".repeat(81) },
    { ...draft, title: "x".repeat(121) },
    { ...draft, avatarHue: 20 },
    { ...draft, avatarSeed: "../avatar.png" },
    { ...draft, sectionId: "" },
  ]) {
    expect(() => decodeProfileV4Draft(invalid, true)).toThrow("Invalid profile v4 draft.");
  }
  expect(() => decodeProfileV4Response(true, blank)).toThrow("Invalid profile v4 draft.");
  expect(() => decodeProfileV4Request(false, { operationId: "invalid", draft })).toThrow("Invalid profile v4 save.");
  expect(() => decodeProfileV4Request(true, { prompt: " ", draft })).toThrow("Invalid profile v4 prompt.");
});

it("carries a browser view session and refuses one the host did not name", () => {
  const path = TEAM_API_ROUTES.browser.viewSessions;
  const request = { tabId: "tab-1" };
  expect(
    decodeTeamProtocolV4CurrentHttpRequest(
      "POST",
      path,
      JSON.parse(encodeTeamProtocolV4CurrentHttpRequest("POST", path, request)),
    ),
  ).toEqual(request);
  const session = {
    id: "view-1",
    tabId: "tab-1",
    streamPath: browserViewStreamPath("view-1"),
  };
  expect(
    decodeTeamProtocolV4CurrentHttpResponse(
      "POST",
      path,
      200,
      JSON.parse(encodeTeamProtocolV4CurrentHttpResponse("POST", path, 200, session)),
    ),
  ).toEqual(session);
  // The client opens a socket at the path the host answers with, so a path for another session -- or
  // for anything that is not a stream -- must not survive the response.
  expect(() =>
    encodeTeamProtocolV4CurrentHttpResponse("POST", path, 200, { ...session, streamPath: "/v1/browser/view/other" }),
  ).toThrow("Invalid browser view response.");
  // Ending the session is a DELETE, and the v3 frame a WebRTC request falls through to cannot learn
  // a route added after it was frozen, so the frame it sends is empty.
  const ended = TEAM_API_ROUTES.browser.viewSession("view-1");
  expect(encodeTeamProtocolV4WebRtcHttpRequest("DELETE", ended, null)).toEqual({});
  expect(decodeTeamProtocolV4WebRtcHttpRequest("DELETE", ended, {})).toEqual({});
});
