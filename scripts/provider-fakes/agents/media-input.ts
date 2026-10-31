// The agents of `acp-media-input-e2e.ts`. `FAKE_MODE` picks the prompt capabilities: "gemini" takes
// images, audio and embedded context as Gemini CLI 0.66.0 does, "opencode" takes images and embedded
// context as OpenCode does, and "plain" takes images only. The log has one entry for each prompt
// block, with a digest of the bytes in place of the bytes.
import { createHash } from "node:crypto";
import { type AcpHandler, logEntry, serveFakeAcpAgent } from "../acp-agent";

const mode = process.env.FAKE_MODE;
const capabilities =
  mode === "gemini"
    ? { image: true, audio: true, embeddedContext: true }
    : mode === "opencode"
      ? { image: true, embeddedContext: true }
      : { image: true };
let sessions = 0;

const digest = (base64: string | undefined) =>
  base64 === undefined ? null : createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex");

const session: AcpHandler = (request, peer) => {
  if (request.method === "session/new") {
    sessions += 1;
    peer.reply(request, { sessionId: `s-${sessions}` });
  } else {
    peer.reply(request, {});
  }
};

serveFakeAcpAgent({
  initialize: (request, peer) => {
    peer.reply(request, {
      protocolVersion: 1,
      agentInfo: { name: "fake", title: mode, version: "1.0.0" },
      agentCapabilities: { loadSession: true, promptCapabilities: capabilities },
    });
  },
  "session/new": session,
  "session/load": session,
  "session/prompt": (request, peer) => {
    (request.params.prompt ?? []).forEach((block, index) => {
      logEntry({
        index,
        type: block.type,
        text: block.type === "text" ? (block.text ?? null) : null,
        mimeType: block.mimeType ?? block.resource?.mimeType ?? null,
        uri: block.resource?.uri ?? null,
        sha256: digest(block.data ?? block.resource?.blob),
      });
    });
    peer.say(request.params.sessionId, "OK");
    peer.reply(request, { stopReason: "end_turn" });
  },
});
