// The agent of `antigravity-expired-token-e2e.ts`. The Antigravity CLI 1.5.4 refreshes its Google
// token when a process opens its first session. When Google refuses the token, it answers
// `session/new` with ACP's `authRequired` error (-32000, "Authentication required") and opens no
// browser (checked with 1.5.4). This fake does the same while the file in `FAKE_TOKEN_REFUSED`
// exists, and logs its pid first. It answers `--version` as the CLI does.
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
