import { type AcpHandler, logEntry, serveFakeAcpAgent } from "../acp-agent";

let sessions = 0;

const session: AcpHandler = (request, peer) => {
  const names = (request.params.mcpServers ?? []).map((server) => server.name);
  logEntry({ method: request.method, names });
  if (names.some((name) => !/^[A-Za-z0-9_-]+$/u.test(name))) {
    peer.fail(request, { code: -32602, message: "Invalid params" });
    return;
  }
  if (request.method === "session/new") {
    sessions += 1;
    peer.reply(request, { sessionId: `s-${sessions}` });
  } else {
    peer.reply(request, {});
  }
};

serveFakeAcpAgent({
  initialize: (request, peer) => {
    peer.reply(request, {
      protocolVersion: 1,
      agentInfo: { name: "fake", title: "mcp-names", version: "1.0.0" },
      agentCapabilities: { loadSession: true },
    });
  },
  "session/new": session,
  "session/load": session,
  "session/prompt": (request, peer) => {
    peer.say(request.params.sessionId, "OK");
    peer.reply(request, { stopReason: "end_turn" });
  },
});
