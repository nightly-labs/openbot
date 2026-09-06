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
});
