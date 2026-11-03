// The agent of `antigravity-expired-token-e2e.ts`. Antigravity 1.4.5 refreshes its Google token when a
// process opens its first session. When Google refuses the token, it prints its browser sign-in link
// on stderr and does not answer `session/new` for five minutes, and then deletes the saved token.
// This fake does the same while the file in `FAKE_TOKEN_REFUSED` exists, and logs its pid first.
import { existsSync } from "node:fs";
import { logEntry, serveFakeAcpAgent } from "../acp-agent";

const MODELS = {
  availableModels: [{ modelId: "gemini-3-flash", name: "Gemini 3 Flash" }],
  currentModelId: "gemini-3-flash",
};
let sessions = 0;

serveFakeAcpAgent({
  initialize: (request, peer) => {
    peer.reply(request, { protocolVersion: 1, authMethods: [], agentCapabilities: { loadSession: true } });
  },
  "session/new": (request, peer) => {
    if (existsSync(process.env.FAKE_TOKEN_REFUSED ?? "")) {
      logEntry({ method: request.method, pid: process.pid, refused: true });
      process.stderr.write(
        "Open the following link to authenticate the ACP server: https://accounts.google.com/o/oauth2/v2/auth?state=fake\n",
      );
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
