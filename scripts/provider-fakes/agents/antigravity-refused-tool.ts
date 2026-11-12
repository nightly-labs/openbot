// The agent of the refused tool schema cases in `antigravity-mcp-load-failure-e2e.ts` (#7228). The
// Antigravity CLI 1.5.6 checks each MCP tool schema when it builds the toolbox of a prompt. When it
// refuses one, it writes the tool only to its own log, answers "Agent execution terminated due to
// error." and ends the turn as a success. A session keeps the servers that its process started, also
// after a resume without them. This fake does the same: a session with the server `resend` refuses
// `mcp_resend_get-contact`, and a prompt with `REFUSE_TOOL=<tool>` refuses that tool, as for a server from the
// user's own `mcp_config.json`.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { type AcpHandler, type AcpRequest, logEntry, serveFakeAcpAgent } from "../acp-agent";

const MODELS = {
  availableModels: [{ modelId: "gemini-3-flash", name: "Gemini 3 Flash" }],
  currentModelId: "gemini-3-flash",
};
const flag = (name: string) => process.argv.find((arg) => arg.startsWith(name))?.slice(name.length) ?? "";
const folder = join(flag("--gemini-dir="), flag("--app-data-dir="), "log");
mkdirSync(folder, { recursive: true });
const logFile = join(folder, `acp-server-20261111_000000-${process.pid}.log`);
const log = (line: string) => appendFileSync(logFile, `${line}\n`);
log(`I1111 00:00:00.000000       1 options.go:485] Starting ACP server (pid ${process.pid})`);

/** The servers of each session that this process started. A resume does not change them. */
const started = new Map<string, string[]>();
let sessions = 0;

function record(request: AcpRequest, sessionId: string): void {
  const names = (request.params.mcpServers ?? []).map((server) => server.name);
  if (!started.has(sessionId)) started.set(sessionId, names);
  logEntry({ method: request.method, sessionId, pid: process.pid, names });
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
    const sessionId = `s-${process.pid}-${sessions}`;
    record(request, sessionId);
    peer.reply(request, { sessionId, models: MODELS });
  },
  "session/resume": resume,
  "session/load": resume,
  "session/prompt": (request, peer) => {
    const sessionId = request.params.sessionId ?? "";
    const text = (request.params.prompt ?? []).map((block) => block.text ?? "").join("");
    log(`I1111 00:00:00.100000     218 server.go:1817] Sending user message to conversation ${sessionId} (items=1)`);
    const refused =
      /REFUSE_TOOL=(\S+)/u.exec(text)?.[1] ??
      (started.get(sessionId)?.includes("resend") ? "mcp_resend_get-contact" : null);
    logEntry({ method: request.method, sessionId, pid: process.pid, refused });
    if (refused) {
      log(
        `E1111 00:00:00.200000     294 errorreport.go:273] agent executor error: building toolbox: tool "${refused}" advertises an invalid parameter schema: "schema://tool-parameters.json#" is not valid against metaschema`,
      );
      peer.say(sessionId, "\n⚠ Agent execution terminated due to error.\n");
    } else peer.say(sessionId, "OK");
    peer.reply(request, { stopReason: "end_turn" });
  },
});
