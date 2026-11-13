// The agent of `acp-mcp-server-names-e2e.ts`. It logs the MCP server names of each session request
// and refuses a name with a character outside `[A-Za-z0-9_-]`, as Antigravity does (#2801).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getRecord } from "../../../src/backend/protocol";
import { type AcpHandler, logEntry, serveFakeAcpAgent } from "../acp-agent";

let sessions = 0;

const session: AcpHandler = (request, peer) => {
  const names = (request.params.mcpServers ?? []).map((server) => server.name);
  let ownNames: string[] = [];
  try {
    const cwd = request.params.cwd;
    if (cwd) {
      const config = getRecord(JSON.parse(readFileSync(join(cwd, ".agents", "mcp_config.json"), "utf8")), "mcpServers");
      if (config) ownNames = Object.keys(config);
    }
  } catch {
    // The fake workspace has no Antigravity MCP configuration.
  }
  logEntry({ method: request.method, names, ownNames });
  if (names.some((name) => !/^[A-Za-z0-9_-]+$/u.test(name))) {
    peer.fail(request, { code: -32602, message: "Invalid params" });
    return;
  }
  const duplicate = names.find((name) => ownNames.some((own) => own.toLowerCase() === name.toLowerCase()));
  if (duplicate) {
    peer.fail(request, {
      code: -32602,
      message: `failed to construct executor: tool name conflict: multiple tools resolved with name mcp_${duplicate.toLowerCase()}_creative_update_brand_kit`,
    });
    return;
  }
  if (request.method === "session/new") {
    sessions += 1;
    peer.reply(request, {
      sessionId: `s-${sessions}`,
      models: { availableModels: [{ modelId: "fake-alpha", name: "Fake Alpha" }], currentModelId: "fake-alpha" },
    });
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
