import { readFileSync } from "node:fs";
import { type AcpPeer, type AcpRequest, logEntry, serveFakeAcpAgent } from "../acp-agent";

if (process.argv.includes("--version")) {
  process.stdout.write("1.5.11\n");
  process.exit(0);
}

let sessions = 0;

function setup(request: AcpRequest, peer: AcpPeer, sessionId: string): void {
  const ids: string[] = JSON.parse(readFileSync(process.env.FAKE_CONTROL ?? "", "utf8")).models;
  logEntry({ event: "setup", method: request.method, sessionId, models: ids });
  const availableModels = ids.map((modelId) => ({ modelId, name: modelId }));
  peer.reply(request, { sessionId, models: { availableModels, currentModelId: ids[0] } });
}

serveFakeAcpAgent({
  initialize: (request, peer) =>
    peer.reply(request, {
      protocolVersion: 1,
      agentInfo: { name: "Antigravity ACP Server", version: "1.5.11" },
      agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } },
      authMethods: [],
    }),
  "session/new": (request, peer) => {
    sessions += 1;
    setup(request, peer, `agy-${process.pid}-${sessions}`);
  },
  "session/resume": (request, peer) => setup(request, peer, request.params.sessionId ?? ""),
});
