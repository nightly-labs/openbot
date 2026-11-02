// The `opencode acp` of `opencode-thought-interleave-e2e.ts`. OpenCode 1.18.31 and 2.1.4 pass on the
// reasoning that an endpoint streams between answer tokens as `agent_thought_chunk` (#3351). A prompt
// with `interleave` answers in sub-word tokens with a thought after some of them. A prompt with
// `harness` sends a partial answer, the harness error report of #1471, and the retried answer.
import { serveFakeAcpAgent } from "../acp-agent";

const MODEL = "opencode/big-pickle";
const TOKENS = [
  "B",
  "aca",
  " gambar",
  ".",
  " G",
  "ambar",
  ":",
  " tabel",
  " R",
  "enc",
  "ana",
  " (",
  "prot",
  "otype",
  ").",
];

let count = 0;
serveFakeAcpAgent({
  initialize: (request, peer) =>
    peer.reply(request, { protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [] }),
  "session/new": (request, peer) => {
    count += 1;
    peer.reply(request, {
      sessionId: `s-${process.pid}-${count}`,
      models: { availableModels: [{ modelId: MODEL, name: "Big Pickle" }], currentModelId: MODEL },
    });
  },
  "session/prompt": (request, peer) => {
    const { sessionId } = request.params;
    const prompt = request.params.prompt?.map((part) => part.text ?? "").join("") ?? "";
    if (prompt.includes("harness")) {
      peer.say(sessionId, "Partial ans");
      peer.say(sessionId, "API Error: The stream ended. The response above may be incomplete.");
      peer.say(sessionId, "Full answer.");
    } else {
      for (const [index, token] of TOKENS.entries()) {
        peer.say(sessionId, token);
        if (index % 3 === 0)
          peer.update(sessionId, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hmm" } });
      }
    }
    peer.reply(request, { stopReason: "end_turn" });
  },
});
