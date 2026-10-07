import { describe, expect, it } from "vitest";
import { TEAM_CURRENT_CAPABILITIES } from "./current";
import { TEAM_MESSAGE_CLIENT_ID_CAPABILITY } from "./message-client-id-v1";
import { decodeTeamProtocolV4CurrentHttpRequest } from "./v4-adapter";
import { decodeTeamProtocolV5CurrentHttpRequest, encodeTeamProtocolV5CurrentHttpRequest } from "./v5-adapter";
import { decodeTeamProtocolV6CurrentHttpRequest, encodeTeamProtocolV6CurrentHttpRequest } from "./v6-adapter";
import { encodeTeamProtocolV6WebRtcHttpRequest } from "./v6-webrtc-adapter";

describe("message-client-id-v1", () => {
  const path = "/v1/agents/chief/messages";
  const input = { text: "Hello", attachmentDraftIds: [], replyToMessageId: null, clientMessageId: "client-1" };

  it("carries the client id on a message from v5; v4 drops it, and a malformed one fails closed", () => {
    expect(TEAM_CURRENT_CAPABILITIES).toContain(TEAM_MESSAGE_CLIENT_ID_CAPABILITY);
    const v5 = JSON.parse(encodeTeamProtocolV5CurrentHttpRequest("POST", path, input));
    expect(decodeTeamProtocolV5CurrentHttpRequest("POST", path, v5)).toEqual(input);
    const v6 = JSON.parse(encodeTeamProtocolV6CurrentHttpRequest("POST", path, input));
    expect(decodeTeamProtocolV6CurrentHttpRequest("POST", path, v6)).toEqual(input);
    expect(
      decodeTeamProtocolV6CurrentHttpRequest("POST", path, encodeTeamProtocolV6WebRtcHttpRequest("POST", path, input)),
    ).toEqual(input);

    // An older host never reads it, so a client retries only behind the capability.
    expect(decodeTeamProtocolV4CurrentHttpRequest("POST", path, v5)).not.toHaveProperty("clientMessageId");

    for (const clientMessageId of [7, "", "x".repeat(129)]) {
      expect(() => decodeTeamProtocolV6CurrentHttpRequest("POST", path, { ...v6, clientMessageId })).toThrow(
        "Invalid client message id.",
      );
    }
  });
});
