// The `opencode acp` of `opencode-thought-interleave-e2e.ts`. OpenCode 1.18.31 and 2.1.4 pass on the
// reasoning that an endpoint streams between answer tokens as `agent_thought_chunk` (#3351). A prompt
// with `interleave` answers in sub-word tokens with a thought after some of them. A prompt with
// `harness` sends a partial answer, the harness error report of #1471, and the retried answer. A
// prompt with `parts` sends two reasoning parts of one message, each with its own `messageId`, as
// OpenCode 2.2.5 does (#5481).
import type { SessionUpdate } from "@agentclientprotocol/sdk";
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

/** Two reasoning parts of one message, then the answer. The first part arrives in two chunks. */
const PARTS: readonly SessionUpdate[] = [
  { sessionUpdate: "agent_thought_chunk", messageId: "m1:reasoning:0", content: { type: "text", text: "**Scanning" } },
  { sessionUpdate: "agent_thought_chunk", messageId: "m1:reasoning:0", content: { type: "text", text: " files**" } },
  {
    sessionUpdate: "agent_thought_chunk",
    messageId: "m1:reasoning:1",
    content: { type: "text", text: "**Checking notes**" },
  },
  { sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: "Both parts are read." } },
];

/** The stored turn that `session/load` replays: the user prompt, the two parts, and the answer. */
const HISTORY: readonly SessionUpdate[] = [
  { sessionUpdate: "user_message_chunk", messageId: "m1:user", content: { type: "text", text: "parts" } },
  ...PARTS,
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
  // A thread that this client does not hold is read from the agent's own store.
  "session/load": (request, peer) => {
    for (const update of HISTORY) peer.update(request.params.sessionId, update);
    peer.reply(request, {});
  },
  "session/prompt": (request, peer) => {
    const { sessionId } = request.params;
    const prompt = request.params.prompt?.map((part) => part.text ?? "").join("") ?? "";
    if (prompt.includes("harness")) {
      peer.say(sessionId, "Partial ans");
      peer.say(sessionId, "API Error: The stream ended. The response above may be incomplete.");
      peer.say(sessionId, "Full answer.");
    } else if (prompt.includes("parts")) {
      for (const update of PARTS) peer.update(sessionId, update);
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
