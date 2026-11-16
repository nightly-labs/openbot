// The Grok agent of `grok-question-e2e.ts`. Each prompt asks the client two questions with
// `_x.ai/ask_user_question`, with the request of the real Grok 1.0.77, and logs the client's reply.
// It then reads the reply as Grok does: a reply without `outcome` fails the tool.
import { logEntry, serveFakeAcpAgent } from "../acp-agent";

const MODELS = [{ modelId: "grok-fake", name: "Grok Fake" }];
let count = 0;

serveFakeAcpAgent({
  initialize: (request, peer) =>
    peer.reply(request, {
      protocolVersion: 1,
      agentInfo: { name: "grok", version: "1.0.77" },
      agentCapabilities: { loadSession: true },
      authMethods: [],
    }),
  "session/new": (request, peer) => {
    count += 1;
    peer.reply(request, {
      sessionId: `grok-${process.pid}-${count}`,
      models: { availableModels: MODELS, currentModelId: "grok-fake" },
    });
  },
  "session/prompt": (request, peer) => {
    const sessionId = request.params.sessionId ?? "";
    void peer
      .ask("_x.ai/ask_user_question", {
        sessionId,
        toolCallId: "call-1",
        questions: [
          {
            question: "Which color?",
            options: [
              { label: "Red", description: "Warm" },
              { label: "Blue", description: "Cold" },
            ],
            multiSelect: null,
          },
          {
            question: "Which sizes?",
            options: [
              { label: "Small", description: "S" },
              { label: "Large", description: "L" },
            ],
            multiSelect: true,
          },
        ],
        mode: "default",
      })
      .then((reply) => {
        const text = JSON.stringify(reply);
        logEntry({ event: "reply", sessionId, text });
        peer.say(sessionId, text.includes('"outcome"') ? "answered" : "missing field `outcome`");
        peer.reply(request, { stopReason: "end_turn" });
      });
  },
});
