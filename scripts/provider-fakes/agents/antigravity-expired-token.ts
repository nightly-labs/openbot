import { existsSync } from "node:fs";
import { logEntry, serveFakeAcpAgent } from "../acp-agent";

const MODELS = {
  availableModels: [{ modelId: "gemini-3-flash", name: "Gemini 3 Flash" }],
  currentModelId: "gemini-3-flash",
};
let sessions = 0;

if (process.argv.includes("--version")) {
  process.stdout.write("1.5.4\n");
  process.exit(0);
}

serveFakeAcpAgent({
  initialize: (request, peer) => {
    peer.reply(request, { protocolVersion: 1, authMethods: [], agentCapabilities: { loadSession: true } });
  },
  "session/new": (request, peer) => {
    if (existsSync(process.env.FAKE_TOKEN_REFUSED ?? "")) {
      logEntry({ method: request.method, pid: process.pid, refused: true });
      peer.fail(request, { code: -32000, message: "Authentication required" });
      return;
    }
    sessions += 1;
    const sessionId = `s-${process.pid}-${sessions}`;
    logEntry({ method: request.method, pid: process.pid, sessionId });
    peer.reply(request, { sessionId, models: MODELS });
  },
  "session/prompt": (request, peer) => {
    peer.say(request.params.sessionId ?? "", "OK");
    peer.reply(request, { stopReason: "end_turn" });
  },
});
