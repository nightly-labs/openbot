// The custom agent of `acp-flavor-e2e.ts`. It opens sessions, and `session/load` fails with the error
// that `FAKE_LOAD_ERROR` names, as an agent does after a restart that lost the session.
import { type AcpError, logEntry, serveFakeAcpAgent } from "../acp-agent";

const LOAD_ERRORS: Readonly<Partial<Record<string, (sessionId: string) => AcpError>>> = {
  // omp 18.8.4 (#1690).
  unsupported: (sessionId) => ({
    code: -32603,
    message: "Internal error",
    data: { details: `Unsupported ACP session: ${sessionId}` },
  }),
  "unsupported-other": () => ({
    code: -32603,
    message: "Internal error",
    data: { details: "Unsupported ACP session: another-session" },
  }),
  "not-found": (sessionId) => ({ code: -32002, message: "Resource not found", data: { uri: sessionId } }),
  internal: () => ({ code: -32603, message: "Internal error", data: { details: "database is locked" } }),
};

const mode = process.env.FAKE_LOAD_ERROR ?? "";
let sessions = 0;
serveFakeAcpAgent(
  {
    initialize: (request, peer) =>
      peer.reply(request, {
        protocolVersion: 1,
        agentInfo: { name: "fake", version: "1.0.0" },
        agentCapabilities: { loadSession: true },
      }),
    "session/new": (request, peer) => {
      sessions += 1;
      peer.reply(request, { sessionId: `s-${process.pid}-${sessions}` });
    },
    "session/load": (request, peer) => {
      const error = LOAD_ERRORS[mode];
      if (error) peer.fail(request, error(request.params.sessionId ?? ""));
      else peer.reply(request, {});
    },
  },
  { onRequest: (request) => logEntry({ method: request.method, sessionId: request.params.sessionId ?? null }) },
);
