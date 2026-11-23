import { randomUUID } from "node:crypto";
import { type AcpHandler, logEntry, serveFakeAcpAgent } from "../acp-agent";

const deletes = process.env.FAKE_DELETES === "1";

const session: AcpHandler = (request, peer) => {
  if (request.method === "session/new") {
    const sessionId = randomUUID();
    logEntry({ method: "session/new", sessionId });
    peer.reply(request, { sessionId });
  } else peer.reply(request, {});
};

serveFakeAcpAgent(
  {
    initialize: (request, peer) =>
      peer.reply(request, {
        protocolVersion: 1,
        agentInfo: { name: "fake", title: "throwaway sessions", version: "1.0.0" },
        agentCapabilities: {
          loadSession: true,
          sessionCapabilities: deletes ? { resume: {}, delete: {} } : { resume: {} },
        },
      }),
    "session/new": session,
    "session/load": session,
    "session/resume": session,
    "session/prompt": (request, peer) => {
      const sessionId = request.params.sessionId ?? "";
      logEntry({ method: "session/prompt", sessionId });
      peer.say(sessionId, '{"verdict":"done"}');
      peer.reply(request, { stopReason: "end_turn" });
    },
  },
  {
    onRequest: (request) => {
      if (request.method === "session/delete")
        logEntry({ method: "session/delete", sessionId: request.params.sessionId ?? "" });
    },
  },
);
