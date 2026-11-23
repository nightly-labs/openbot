import { type AcpError, logEntry, serveFakeAcpAgent } from "../acp-agent";

const LOAD_ERRORS: Readonly<Partial<Record<string, (sessionId: string) => AcpError>>> = {
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
  "session-not-found": (sessionId) => ({ code: -32002, message: "Resource not found", data: { sessionId } }),
  "session-not-found-other": () => ({
    code: -32002,
    message: "Resource not found",
    data: { sessionId: "another-session" },
  }),
  internal: () => ({ code: -32603, message: "Internal error", data: { details: "database is locked" } }),
  "invalid-id": (sessionId) => ({
    code: -32603,
    message: "Internal error",
    data: { details: invalidSessionIdentifier(sessionId) },
  }),
  "invalid-id-other": () => ({
    code: -32603,
    message: "Internal error",
    data: { details: invalidSessionIdentifier("another-session") },
  }),
  "unknown-id": (sessionId) => ({ code: -32602, message: `Session not found: ${sessionId}` }),
  "unknown-id-other": () => ({ code: -32602, message: "Session not found: another-session" }),
};

function invalidSessionIdentifier(sessionId: string): string {
  return `Invalid session identifier "${sessionId}".\n  Searched for sessions in /workspace/.chats.\n  Use --list-sessions to see available sessions.`;
}

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
