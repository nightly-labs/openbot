// The `opencode acp` of `opencode-downgraded-session-e2e.ts`, which acts as OpenCode 1.19.3 does on
// sessions that OpenCode 2.0 wrote. Sessions named `v2-…` are in the table this version cannot read:
// not listed, and not resumable. `kept-…` sessions are listed but fail to resume, as an internal fault
// does. `v1only-…` and `othercwd-…` get the OpenCode 2.x answers for a session it does not have and
// for another directory.
import { type AcpHandler, logEntry, serveFakeAcpAgent } from "../acp-agent";

const MODEL = "opencode/minimax-m3.1-flash-free";
const setup = (sessionId: string | undefined) => ({
  sessionId,
  models: { availableModels: [{ modelId: MODEL, name: "MiniMax" }], currentModelId: MODEL },
});

const reopen: AcpHandler = (request, peer) => {
  const { sessionId = "", cwd } = request.params;
  logEntry({ event: request.method, sessionId });
  if (/^(?:v2|kept)-/.test(sessionId)) {
    peer.fail(request, {
      code: -32603,
      message: "Internal error: OpenCode service failure",
      data: { service: "session" },
    });
  } else if (sessionId.startsWith("v1only-")) {
    peer.fail(request, {
      code: -32602,
      message: `Invalid params: session not found: ${sessionId}`,
      data: { sessionId },
    });
  } else if (sessionId.startsWith("othercwd-")) {
    peer.fail(request, {
      code: -32602,
      message: `Invalid params: session ${sessionId} does not belong to cwd: ${cwd}`,
      data: { sessionId, cwd },
    });
  } else {
    peer.reply(request, setup(sessionId));
  }
};

let count = 0;
serveFakeAcpAgent({
  initialize: (request, peer) =>
    peer.reply(request, {
      protocolVersion: 1,
      authMethods: [],
      agentCapabilities: { loadSession: true, sessionCapabilities: { close: {}, fork: {}, list: {}, resume: {} } },
    }),
  "session/new": (request, peer) => {
    count += 1;
    peer.reply(request, setup(`s-${process.pid}-${count}`));
  },
  "session/resume": reopen,
  "session/load": reopen,
  "session/list": (request, peer) => {
    logEntry({ event: "session/list" });
    peer.reply(request, { sessions: [{ sessionId: "kept-1", cwd: request.params.cwd }] });
  },
});
