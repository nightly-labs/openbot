// @vitest-environment node
import { describe, expect, it } from "vitest";
import { classifyRemoteConnectionError, classifyTransportError } from "./remote-server-connection-status";
import { RemoteProtocolError, RemoteRequestError } from "./remote-server-errors";

describe("classifyRemoteConnectionError", () => {
  it("tells an out-of-date end from a wire this app cannot read", () => {
    expect(classifyRemoteConnectionError(new RemoteProtocolError("client_update_required", "Update OpenBot."))).toEqual(
      {
        issue: {
          code: "client_update_required",
          message: "Update OpenBot.",
          retryable: true,
          reference: "protocol/client_update_required",
        },
        state: "incompatible",
        suspendReconnect: true,
        hostSupport: null,
      },
    );
    expect(classifyRemoteConnectionError(new RemoteProtocolError("protocol_error", "Bad frame.")).state).toBe("error");
  });

  it("keeps what the host said it supports, so the app can say which end to update", () => {
    const support = { appVersion: "9.9.9", protocol: { minimum: 4, maximum: 5 }, capabilities: ["remote-desktop"] };
    const outcome = classifyRemoteConnectionError(
      new RemoteProtocolError("client_update_required", "Update OpenBot.", support),
    );
    expect(outcome.hostSupport).toEqual(support);
  });

  it("answers a 401 in its own words rather than the host's", () => {
    const outcome = classifyRemoteConnectionError(new RemoteRequestError(401, "jwt malformed"));
    expect(outcome.issue).toEqual({
      code: "authentication_required",
      message: "Sign in to this host again.",
      retryable: true,
      reference: "http/401",
    });
    expect(outcome.suspendReconnect).toBe(true);
  });

  it("leaves an ordinary refusal to the caller instead of blaming the connection", () => {
    expect(classifyRemoteConnectionError(new RemoteRequestError(404, "No such agent."))).toEqual({
      issue: null,
      state: null,
      suspendReconnect: false,
      hostSupport: null,
    });
  });

  it("stops reconnecting for a body it cannot parse, but keeps trying when the host is unreachable", () => {
    const unparseable = classifyRemoteConnectionError(new SyntaxError("Unexpected token <"));
    expect(unparseable.issue?.code).toBe("protocol_error");
    expect(unparseable.suspendReconnect).toBe(true);

    const unreachable = classifyRemoteConnectionError(new TypeError("fetch failed"));
    expect(unreachable.issue?.code).toBe("network_unavailable");
    expect(unreachable.state).toBe("offline");
    expect(unreachable.suspendReconnect).toBe(false);
  });

  it("says nothing about a failure it does not recognise", () => {
    expect(classifyRemoteConnectionError(new Error("boom")).issue).toBeNull();
  });

  it.each([
    [
      new RemoteRequestError(426, "Upgrade.", "client_update_required"),
      "http/426/client_update_required",
      "Update this OpenBot app before connecting to the host.",
    ],
    [
      new RemoteRequestError(400, "Bad headers.", "protocol_error"),
      "http/400/protocol_error",
      "The host refused the request (400).",
    ],
    [
      new RemoteRequestError(502, "Bad body.", "protocol_error"),
      "http/502/protocol_error",
      "The host returned invalid data.",
    ],
    [new RemoteRequestError(401, "Sign in again.", null, "http/403"), "http/403", "Sign in to this host again."],
    [
      new RemoteProtocolError("protocol_error", "The host returned invalid data."),
      "protocol/protocol_error",
      "The host returned invalid data.",
    ],
    [new SyntaxError("Unexpected token <"), "protocol/invalid_json", "The host returned invalid data."],
    [new TypeError("fetch failed"), "network/fetch", "The host is not reachable."],
  ])("gives %o the reference %s", (error, reference, message) => {
    expect(classifyRemoteConnectionError(error).issue).toMatchObject({ reference, message });
  });
});

describe("classifyTransportError", () => {
  it("reports a revoked session as needing a sign-in, and stops reconnecting", () => {
    expect(classifyTransportError("session_revoked", "Session revoked.")).toEqual({
      issue: {
        code: "authentication_required",
        message: "Session revoked.",
        retryable: false,
        reference: "signal/session_revoked",
      },
      state: "error",
      suspendReconnect: true,
      hostSupport: null,
    });
  });

  it("agrees with the HTTP path that a protocol error is incompatibility, not a retryable blip", () => {
    const outcome = classifyTransportError("protocol_error", "Unsupported frame.");
    expect(outcome.state).toBe("incompatible");
    expect(outcome.issue?.retryable).toBe(false);
    expect(outcome.suspendReconnect).toBe(true);
  });

  it("keeps retrying anything else", () => {
    expect(classifyTransportError("ice_failed", "The connection dropped.")).toEqual({
      issue: {
        code: "network_unavailable",
        message: "The connection dropped.",
        retryable: true,
        reference: "transport/ice_failed",
      },
      state: "error",
      suspendReconnect: false,
      hostSupport: null,
    });
  });

  // The Signal text is for a developer, so each released Signal code gets its own sentence.
  it.each([
    ["host_unavailable", "network_unavailable", "The host is offline."],
    ["host_busy", "network_unavailable", "The host is busy with another connection. Try again in a moment."],
    [
      "permission_denied",
      "network_unavailable",
      "Your account does not have access to this host. Ask the owner for access.",
    ],
    ["rate_limited", "network_unavailable", "Too many connection attempts. OpenBot tries again in 60 seconds."],
    [
      "protocol_error",
      "protocol_error",
      "Signal and this app do not agree on the connection protocol. Update OpenBot, then try again.",
    ],
    ["invalid_message", "network_unavailable", "Signal returned an invalid message."],
    ["authentication_required", "network_unavailable", "Remote ticket is invalid or expired."],
    ["session_revoked", "authentication_required", "Remote access was revoked."],
  ])("maps Signal %s to its own sentence and reference", (code, issueCode, message) => {
    expect(classifyTransportError(code, "Remote access was revoked.").issue).toMatchObject({
      code: issueCode,
      message,
      reference: `signal/${code}`,
    });
  });

  it("gives no reference for a code that is not an identifier", () => {
    expect(classifyTransportError("bad code/../x", "WebRTC failed.").issue).not.toHaveProperty("reference");
  });
});
