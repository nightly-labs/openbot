// The GitHub Copilot agent of `copilot-mcp-relay-e2e.ts`. As GitHub Copilot CLI 1.0.105 does, it
// advertises only http and sse MCP servers and starts no stdio server of a session
// (github/copilot-cli#3889). It lists the tools of each http server and logs them.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { type AcpHandler, type AcpParams, logEntry, serveFakeAcpAgent } from "../acp-agent";

type SessionServer = NonNullable<AcpParams["mcpServers"]>[number];

const MODELS = [{ modelId: "copilot-fake", name: "Copilot Fake" }];
let count = 0;

async function listTools(server: SessionServer): Promise<string[]> {
  const client = new Client({ name: "fake-copilot", version: "1.0.105" });
  const headers = Object.fromEntries((server.headers ?? []).map(({ name, value }) => [name, value]));
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url ?? ""), { requestInit: { headers } }));
  try {
    return (await client.listTools()).tools.map((tool) => tool.name);
  } finally {
    await client.close();
  }
}

const session: AcpHandler = (request, peer) => {
  void Promise.all(
    (request.params.mcpServers ?? []).map(async (server) => {
      if (server.type !== "http") {
        logEntry({ method: request.method, server: server.name, transport: "stdio", tools: [] });
        return;
      }
      const tools = await listTools(server).catch((error: unknown) => [`error: ${String(error)}`]);
      logEntry({ method: request.method, server: server.name, transport: "http", tools });
    }),
  ).then(() => {
    if (request.method !== "session/new") {
      peer.reply(request, {});
      return;
    }
    count += 1;
    peer.reply(request, {
      sessionId: `copilot-${process.pid}-${count}`,
      models: { availableModels: MODELS, currentModelId: "copilot-fake" },
    });
  });
};

serveFakeAcpAgent({
  initialize: (request, peer) =>
    peer.reply(request, {
      protocolVersion: 1,
      agentInfo: { name: "copilot", version: "1.0.105" },
      agentCapabilities: { loadSession: true, mcpCapabilities: { http: true, sse: true } },
      authMethods: [],
    }),
  "session/new": session,
  "session/load": session,
  "session/prompt": (request, peer) => {
    peer.say(request.params.sessionId, "OK");
    peer.reply(request, { stopReason: "end_turn" });
  },
});
