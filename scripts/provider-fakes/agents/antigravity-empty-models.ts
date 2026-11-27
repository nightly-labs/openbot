import { appendFileSync } from "node:fs";
import { serveFakeAcpAgent } from "../acp-agent";

if (process.argv.includes("--version")) {
  process.stdout.write("1.5.18\n");
  process.exit(0);
}

const MODELS = ["gemini-4-carbon", "gemini-4-argon"];
const emptySessions = Number(process.env.FAKE_ANTIGRAVITY_EMPTY_SESSIONS ?? "0");
const sessionLog = process.env.FAKE_ANTIGRAVITY_SESSION_LOG ?? "";

let count = 0;
serveFakeAcpAgent({
  initialize: (request, peer) =>
    peer.reply(request, {
      protocolVersion: 1,
      agentInfo: { name: "Antigravity ACP Server", version: "1.5.18" },
      agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } },
      authMethods: [],
    }),
  "session/new": (request, peer) => {
    count += 1;
    if (sessionLog) appendFileSync(sessionLog, "session/new\n");
    const ids = count <= emptySessions ? [] : MODELS;
    peer.reply(request, {
      sessionId: `agy-${process.pid}-${count}`,
      models: { availableModels: ids.map((modelId) => ({ modelId, name: modelId })), currentModelId: ids[0] ?? "" },
    });
  },
  "session/prompt": (request, peer) => peer.reply(request, { stopReason: "end_turn" }),
});
