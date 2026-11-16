// Fake Antigravity CLI 1.5.9 for antigravity-quiet-turn-e2e.ts.
// Supports `--version` and ACP stdio turns that:
// - CALL-NO-UPDATE-MARKER: calls OpenBot's `routine_no_update` MCP tool and answers `[[no-update]]`.
// - CALL-NO-UPDATE-INVALID-OUTPUT: calls OpenBot's `routine_no_update` MCP tool, then emits
//   CLI 1.5.9's empty-output warning and retry text ("\n⚠ Model produced invalid output.\nSem novidades.").
// - EMPTY-INVALID-OUTPUT-NO-TOOL: emits "\n⚠ Model produced invalid output." without calling any tool.
// - Otherwise answers "OK".
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { type AcpParams, type AcpPeer, type AcpRequest, logEntry, serveFakeAcpAgent } from "../acp-agent";

if (process.argv.includes("--version")) {
  process.stdout.write("1.5.9\n");
  process.exit(0);
}

const MODELS = {
  availableModels: [{ modelId: "gemini-4-hydrogen", name: "Gemini 4 Hydrogen" }],
  currentModelId: "gemini-4-hydrogen",
};

const serversBySession = new Map<string, NonNullable<AcpParams["mcpServers"]>>();
let sessions = 0;
let toolSeq = 0;

function findOpenBotServer(servers: NonNullable<AcpParams["mcpServers"]>) {
  return servers.find((server) => (server.name === "openbot" || server.name === "openbot_openbot") && server.url);
}

async function callNoUpdate(sessionId: string): Promise<string> {
  const server = findOpenBotServer(serversBySession.get(sessionId) ?? []);
  if (!server?.url) throw new Error(`No openbot HTTP MCP server found for session ${sessionId}.`);
  const headers: Record<string, string> = {};
  for (const header of server.headers ?? []) headers[header.name] = header.value;
  const client = new Client({ name: "fake-antigravity", version: "1.5.9" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: { headers },
  });
  await client.connect(transport);
  try {
    const result = await client.callTool({ name: "routine_no_update", arguments: {} });
    const content = Array.isArray(result.content) ? result.content : [];
    return content
      .map((item) =>
        typeof item === "object" && item !== null && "text" in item && typeof item.text === "string" ? item.text : "",
      )
      .join("\n");
  } finally {
    await client.close();
  }
}

async function handlePrompt(request: AcpRequest, peer: AcpPeer): Promise<void> {
  const sessionId = request.params.sessionId ?? "";
  const promptText = (request.params.prompt ?? []).map((block) => block.text ?? "").join("\n");
  logEntry({ method: "session/prompt", sessionId, text: promptText });
  if (promptText.includes("CALL-NO-UPDATE-MARKER") || promptText.includes("CALL-NO-UPDATE-INVALID-OUTPUT")) {
    toolSeq += 1;
    const toolCallId = `call-${toolSeq}`;
    peer.update(sessionId, {
      sessionUpdate: "tool_call",
      toolCallId,
      title: "Calling openbot.routine_no_update",
      kind: "other",
      status: "in_progress",
    });
    const note = await callNoUpdate(sessionId);
    peer.update(sessionId, {
      sessionUpdate: "tool_call_update",
      toolCallId,
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: note } }],
    });
    logEntry({ method: "routine_no_update", sessionId, text: note });
    if (promptText.includes("CALL-NO-UPDATE-MARKER")) {
      peer.say(sessionId, "[[no-update]]");
    } else {
      peer.say(sessionId, "\n\u26A0 Model produced invalid output.\nSem novidades.");
    }
    peer.reply(request, { stopReason: "end_turn" });
    return;
  }
  if (promptText.includes("EMPTY-INVALID-OUTPUT-NO-TOOL")) {
    peer.say(sessionId, "\n\u26A0 Model produced invalid output.");
    peer.reply(request, { stopReason: "end_turn" });
    return;
  }
  peer.say(sessionId, "OK");
  peer.reply(request, { stopReason: "end_turn" });
}

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
    serversBySession.set(sessionId, request.params.mcpServers ?? []);
    peer.reply(request, { sessionId, models: MODELS });
  },
  "session/load": (request, peer) => {
    const sessionId = request.params.sessionId ?? "";
    serversBySession.set(sessionId, request.params.mcpServers ?? []);
    peer.reply(request, { models: MODELS });
  },
  "session/resume": (request, peer) => {
    const sessionId = request.params.sessionId ?? "";
    serversBySession.set(sessionId, request.params.mcpServers ?? []);
    peer.reply(request, { models: MODELS });
  },
  "session/prompt": (request, peer) => {
    void handlePrompt(request, peer).catch((error: unknown) => {
      peer.fail(request, { code: -32603, message: error instanceof Error ? error.message : String(error) });
    });
  },
});
