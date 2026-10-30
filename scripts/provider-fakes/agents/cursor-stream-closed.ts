// The `cursor-agent acp` of `cursor-stream-closed-e2e.ts`. Cursor 2026.10.22-27dcf5f sends a closed
// stream error as one answer chunk after a turn that succeeded, and then ends the turn (#3334). This
// fake answers each prompt in that way. A prompt with "quote-case" gets an answer that only quotes
// the error.
import { serveFakeAcpAgent } from "../acp-agent";

const MODEL = "auto";
const QUOTED_ANSWER = "Cursor said: Error: RetriableError: WritableIterable is closed";

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
    if (text.includes("quote-case")) {
      peer.say(sessionId, QUOTED_ANSWER);
    } else {
      peer.say(sessionId, "Pong.");
      peer.say(sessionId, "\n\nError: RetriableError: WritableIterable is closed");
    }
    peer.reply(request, { stopReason: "end_turn" });
  },
});
