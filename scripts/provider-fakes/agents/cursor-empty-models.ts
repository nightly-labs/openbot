import { appendFileSync } from "node:fs";
import { serveFakeAcpAgent } from "../acp-agent";

const MODEL = "auto";
const emptySessions = Number(process.env.FAKE_CURSOR_EMPTY_SESSIONS ?? "0");
const sessionLog = process.env.FAKE_CURSOR_SESSION_LOG ?? "";

let count = 0;
serveFakeAcpAgent({
  initialize: (request, peer) =>
    peer.reply(request, {
      protocolVersion: 1,
      agentCapabilities: { loadSession: true },
      authMethods: [{ id: "cursor_login", name: "Cursor Login" }],
    }),
  authenticate: (request, peer) => peer.reply(request, {}),
  "session/new": (request, peer) => {
    count += 1;
    if (sessionLog) appendFileSync(sessionLog, "session/new\n");
    const availableModels = count <= emptySessions ? [] : [{ modelId: MODEL, name: "Auto" }];
    peer.reply(request, {
      sessionId: `s-${process.pid}-${count}`,
      models: { availableModels, currentModelId: availableModels.length > 0 ? MODEL : "" },
    });
  },
  "session/prompt": (request, peer) => peer.reply(request, { stopReason: "end_turn" }),
});
