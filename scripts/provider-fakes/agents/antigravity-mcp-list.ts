import { type AcpHandler, type AcpParams, type AcpRequest, logEntry, serveFakeAcpAgent } from "../acp-agent";

const MODELS = {
  availableModels: [{ modelId: "gemini-3-flash", name: "Gemini 3 Flash" }],
  currentModelId: "gemini-3-flash",
};
const servers = new Map<string, NonNullable<AcpParams["mcpServers"]>>();
let sessions = 0;

function toolCount(text: string): number {
  const answer: { result?: { tools?: readonly object[] } } = JSON.parse(
    text.startsWith("{") ? text : (/^data: (.*)$/mu.exec(text)?.[1] ?? "{}"),
  );
  return answer.result?.tools?.length ?? 0;
}

interface ToolCallParams {
  name: string;
  arguments: Record<string, string>;
}

async function mcpRequest(
  server: NonNullable<AcpParams["mcpServers"]>[number],
  method: string,
  id: number,
  call?: ToolCallParams,
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  for (const header of server.headers ?? []) headers[header.name] = header.value;
  const body =
    method === "initialize"
      ? { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake-agy", version: "1" } }
      : (call ?? {});
  const response = await fetch(server.url ?? "", {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params: body }),
  });
  return response.text();
}

async function callOpenBotTool(sessionId: string): Promise<boolean | null> {
  const server = (servers.get(sessionId) ?? []).find((entry) => entry.type === "http" && entry.name === "openbot");
  if (!server) return null;
  await mcpRequest(server, "initialize", 1);
  const text = await mcpRequest(server, "tools/call", 3, { name: "list_agents", arguments: {} });
  const answer: { result?: { isError?: boolean } } = JSON.parse(
    text.startsWith("{") ? text : (/^data: (.*)$/mu.exec(text)?.[1] ?? "{}"),
  );
  return answer.result?.isError === false;
}

async function listOpenBotTools(sessionId: string): Promise<number> {
  let count = 0;
  for (const server of servers.get(sessionId) ?? []) {
    if (server.type !== "http" || !server.name.startsWith("openbot")) continue;
    await mcpRequest(server, "initialize", 1);
    count += toolCount(await mcpRequest(server, "tools/list", 2));
  }
  return count;
}

const open = (sessionId: string, request: AcpRequest, peer: Parameters<AcpHandler>[1]) => {
  servers.set(sessionId, request.params.mcpServers ?? []);
  const mode = process.env.FAKE_OPEN_LIST ?? "now";
  const answer = (listed: number | null) => {
    logEntry({ method: request.method, sessionId, mode, listed });
    peer.reply(request, request.method === "session/new" ? { sessionId, models: MODELS } : { models: MODELS });
  };
  if (mode === "never") return answer(null);
  void listOpenBotTools(sessionId).then(answer);
};

serveFakeAcpAgent({
  initialize: (request, peer) => {
    peer.reply(request, {
      protocolVersion: 1,
      authMethods: [],
      agentInfo: { name: "Antigravity ACP Server", version: process.env.FAKE_VERSION ?? "1.5.12" },
      agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } },
    });
  },
  "session/new": (request, peer) => {
    sessions += 1;
    open(`s-${process.pid}-${sessions}`, request, peer);
  },
  "session/resume": (request, peer) => open(request.params.sessionId ?? "", request, peer),
  "session/prompt": (request, peer) => {
    const sessionId = request.params.sessionId ?? "";
    const text = (request.params.prompt ?? []).map((block) => block.text ?? "").join("");
    const finish = (listed: number | null, called: boolean | null = null) => {
      logEntry({ method: request.method, sessionId, listed, called });
      peer.say(sessionId, "OK");
      peer.reply(request, { stopReason: "end_turn" });
    };
    if (/\bcall\b/u.test(text)) void callOpenBotTool(sessionId).then((called) => finish(null, called));
    else if (/\blist\b/u.test(text)) void listOpenBotTools(sessionId).then((listed) => finish(listed));
    else finish(null);
  },
});
