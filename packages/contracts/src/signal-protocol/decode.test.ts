import { describe, expect, it } from "vitest";
import { decodeSignalServerMessage } from "./decode";
import { SIGNAL_PROTOCOL_VERSION } from "./messages";

const peerReady = {
  type: "peer-ready",
  version: SIGNAL_PROTOCOL_VERSION,
  connectionId: "connection",
  sessionId: "session",
  userId: "user",
  membershipId: "membership",
  role: "member",
  sessionExpiresAt: 1_800_000_000_000,
  resumed: false,
};

const iceCandidate = {
  type: "ice-candidate",
  version: SIGNAL_PROTOCOL_VERSION,
  connectionId: "connection",
  channel: "team",
  candidate: "candidate:0 1 UDP 2122252543 192.0.2.1 50000 typ host",
  sdpMid: "0",
  sdpMLineIndex: 0,
};

describe("decodeSignalServerMessage", () => {
  it("accepts a peer joining", () => {
    expect(decodeSignalServerMessage(peerReady)).toMatchObject({
      type: "peer-ready",
      sessionExpiresAt: 1_800_000_000_000,
    });
  });

  // The desktop forwards this expiry across the renderer-to-main boundary, where the bridge requires
  // a positive integer and parses inside the port listener. A frame the Signal service should never
  // send has to stop at the peer that decodes it, not become a throw in the main process.
  it("refuses an expiry no session could have", () => {
    expect(() => decodeSignalServerMessage({ ...peerReady, sessionExpiresAt: 0 })).toThrow();
  });

  // Zero is the first m-line, so the boundary is worth holding in the same test as the refusal. A
  // negative index is a frame the Signal service never sends, and left to decode it would reach
  // `addIceCandidate` and come back as a WebRTC failure the peer retries instead of a protocol error.
  it("refuses an ICE candidate for an m-line that cannot exist", () => {
    expect(decodeSignalServerMessage(iceCandidate)).toMatchObject({ sdpMLineIndex: 0 });
    expect(() => decodeSignalServerMessage({ ...iceCandidate, sdpMLineIndex: -1 })).toThrow();
  });
});
