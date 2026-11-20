import { serveFakeAcpAgent } from "../acp-agent";

const MODEL = "auto";
const QUOTED_ANSWER = "Cursor said: Error: RetriableError: WritableIterable is closed";
const STREAM_CANCELED = "RetriableError: [canceled] http/2 stream closed with error code CANCEL (0x8)";
const INTERNAL_FAILURE = "\n\nError: RetriableError: [internal] The agent loop failed.";

let count = 0;
serveFakeAcpAgent({
  initialize: (request, peer) =>
    peer.reply(request, { protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [] }),
  "session/new": (request, peer) => {
    count += 1;
    peer.reply(request, {
      sessionId: `s-${process.pid}-${count}`,
      models: { availableModels: [{ modelId: MODEL, name: "Auto" }], currentModelId: MODEL },
    });
  },
  "session/prompt": (request, peer) => {
    const sessionId = request.params.sessionId;
    const text = (request.params.prompt ?? []).map((block) => block.text ?? "").join("");
    if (text.includes("canceled-chunk-case")) {
      peer.say(sessionId, "Checking the webhook.");
      peer.say(sessionId, `\n\nError: ${STREAM_CANCELED}`);
    } else if (text.includes("canceled-recovered-case")) {
      peer.say(sessionId, `\n\nError: ${STREAM_CANCELED}`);
      peer.say(sessionId, "Done.");
    } else if (text.includes("canceled-reject-case")) {
      peer.fail(request, { code: -32603, message: "Internal error", data: { details: STREAM_CANCELED } });
      return;
    } else if (text.includes("internal-case")) {
      peer.say(sessionId, INTERNAL_FAILURE);
    } else if (text.includes("quote-case")) {
      peer.say(sessionId, QUOTED_ANSWER);
    } else {
      peer.say(sessionId, "Pong.");
      peer.say(sessionId, "\n\nError: RetriableError: WritableIterable is closed");
    }
    peer.reply(request, { stopReason: "end_turn" });
  },
});
