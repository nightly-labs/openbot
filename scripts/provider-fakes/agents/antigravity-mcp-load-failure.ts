// The agent of `antigravity-mcp-load-failure-e2e.ts`. Antigravity 1.4.4 ends the whole turn when one
// MCP server does not start (#3824). It logs "Antigravity SDK error processing prompt for session <id>"
// on stderr, sends `mcp_load_failed_message` as answer text and ends the turn as a success. This fake
// does the same for a session that has the server `higgsfield`, and for the server `cloudflare` when
// the prompt is "fail cloudflare", as a server from the user's own `mcp_config.json`.
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type AcpHandler, type AcpRequest, logEntry, serveFakeAcpAgent } from "../acp-agent";

const FAILING_SERVER = "higgsfield";
const names = new Map<string, string[]>();
let sessions = 0;
const MODELS = {
  availableModels: [{ modelId: "gemini-3-flash", name: "Gemini 3 Flash" }],
  currentModelId: "gemini-3-flash",
};

const failure = (name: string) =>
  `The MCP server '${name}' failed to initialize: calling "initialize": sending "initialize": Unauthorized. Fix the MCP server, or remove it from your configuration and start a new session, to continue.`;

function record(request: AcpRequest, sessionId: string): void {
  const servers = (request.params.mcpServers ?? []).map((server) => server.name);
  names.set(sessionId, servers);
  logEntry({ method: request.method, sessionId, names: servers });
}

const resume: AcpHandler = (request, peer) => {
  record(request, request.params.sessionId ?? "");
  peer.reply(request, { models: MODELS });
};

serveFakeAcpAgent({
  initialize: (request, peer) => {
    peer.reply(request, {
      protocolVersion: 1,
      authMethods: [],
      agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } },
    });
  },
  "session/new": (request, peer) => {
    sessions += 1;
    // Unique across processes, as Antigravity's own IDs are: each session has a process of its own.
    const sessionId = `s-${process.pid}-${sessions}`;
    record(request, sessionId);
    peer.reply(request, { sessionId, models: MODELS });
  },
  "session/resume": resume,
  "session/load": resume,
  "session/prompt": (request, peer) => {
    const sessionId = request.params.sessionId ?? "";
    const text = (request.params.prompt ?? []).map((block) => block.text ?? "").join("");
    const failed = text.includes("fail cloudflare")
      ? "cloudflare"
      : names.get(sessionId)?.includes(FAILING_SERVER)
        ? FAILING_SERVER
        : null;
    logEntry({ method: request.method, sessionId, failed });
    if (!failed) {
      peer.say(sessionId, "OK");
      peer.reply(request, { stopReason: "end_turn" });
      return;
    }
    // `FAKE_STDOUT_FIRST`: the message arrives before the stderr line, which the two pipes allow.
    if (process.env.FAKE_STDOUT_FIRST) {
      peer.say(sessionId, failure(failed));
      peer.reply(request, { stopReason: "end_turn" });
      process.stderr.write(`E Antigravity SDK error processing prompt for session ${sessionId}\n`);
      return;
    }
    // Antigravity logs the failure before it sends the message. stderr and stdout are two pipes, so
    // the answer waits until the test has seen the client read the stderr line: it then writes a file
    // named for the session in `FAKE_RELEASE`.
    process.stderr.write(`E Antigravity SDK error processing prompt for session ${sessionId}\n`);
    const release = join(process.env.FAKE_RELEASE ?? "", sessionId);
    const answer = setInterval(() => {
      if (!existsSync(release)) return;
      clearInterval(answer);
      rmSync(release);
      peer.say(sessionId, failure(failed));
      peer.reply(request, { stopReason: "end_turn" });
    }, 10);
  },
});
