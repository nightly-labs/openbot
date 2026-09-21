import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../ipc-agent-events";
import { BROWSER_SECRET_RESPONSE_PATH, parseBrowserSecretResponse } from "../ipc-browser-secret";
import { decodeTeamProtocolV4BaseCurrentEvent, encodeTeamProtocolV4BaseCurrentEvent } from "./v4-base-adapter";
import { decodeTeamProtocolV4WebRtcHttpRequest, encodeTeamProtocolV4WebRtcHttpRequest } from "./v4-webrtc-adapter";

const event: AgentEvent = {
  type: "browser-takeover-requested",
  request: {
    requestId: "auth",
    agentId: "agent",
    threadId: "thread",
    turnId: "turn",
    tabId: "tab",
    secret: { method: "otp", origin: "https://example.com", digits: 6 },
  },
};

describe("secure authentication protocol", () => {
  it("keeps old clients on takeover and sends only public metadata to capable clients", () => {
    const legacy = JSON.parse(encodeTeamProtocolV4BaseCurrentEvent(event) ?? "null");
    expect(legacy.request.secret).toBeUndefined();
    const current = JSON.parse(encodeTeamProtocolV4BaseCurrentEvent(event, { preserveBrowserSecrets: true }) ?? "null");
    expect(decodeTeamProtocolV4BaseCurrentEvent(current)).toEqual({ kind: "known", event });
    current.request.secret.origin = "http://example.com";
    expect(decodeTeamProtocolV4BaseCurrentEvent(current).kind).toBe("invalid");
  });

  it("carries a submission through the dedicated remote request", () => {
    const input = { requestId: "auth", agentId: "agent", decision: "submit", secret: "123456" };
    const wire = encodeTeamProtocolV4WebRtcHttpRequest("POST", BROWSER_SECRET_RESPONSE_PATH, input);
    expect(decodeTeamProtocolV4WebRtcHttpRequest("POST", BROWSER_SECRET_RESPONSE_PATH, wire)).toEqual(input);
  });

  it("does not echo invalid secrets and drops secret data from cancellation", () => {
    const secret = "sensitive".repeat(1000);
    expect(() =>
      parseBrowserSecretResponse({ requestId: "auth", agentId: "agent", decision: "submit", secret }),
    ).toThrow("Invalid secure authentication response.");
    expect(parseBrowserSecretResponse({ requestId: "auth", agentId: "agent", decision: "cancel", secret })).toEqual({
      requestId: "auth",
      agentId: "agent",
      decision: "cancel",
    });
  });
});

it("restores only public authentication metadata after reconnect", () => {
  if (event.type !== "browser-takeover-requested") throw new Error("Missing request fixture.");
  const snapshot: AgentEvent = {
    type: "runtime-snapshot",
    snapshot: {
      agents: [],
      activeTurns: [],
      work: [],
      latestMessages: [],
      attentionComplete: true,
      pendingPrompts: [],
      pendingApprovals: [],
      pendingBrowserTakeovers: [event.request],
      failedTurns: [],
    },
  };
  const encoded = encodeTeamProtocolV4BaseCurrentEvent(snapshot, { preserveBrowserSecrets: true });
  expect(decodeTeamProtocolV4BaseCurrentEvent(JSON.parse(encoded ?? "null"))).toEqual({
    kind: "known",
    event: snapshot,
  });
  const legacy = JSON.parse(encodeTeamProtocolV4BaseCurrentEvent(snapshot) ?? "null");
  expect(legacy.snapshot.pendingBrowserTakeovers[0].secret).toBeUndefined();
});
