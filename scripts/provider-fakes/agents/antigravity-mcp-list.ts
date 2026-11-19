// An agent of `antigravity-mcp-load-failure-e2e.ts`, for #12298. Antigravity 1.5.11 waits 5 s for each
// MCP server of a session to list its tools. A server that is late is not in the prompt's tools, with
// no error, and the CLI tries it again at the next prompt. This fake lists the tools of OpenBot's own
// servers (`openbot*`) over the real bridge: when the session opens (`FAKE_OPEN_LIST`: `now`, `late`
// after `FAKE_LATE_MS`, or `never`), and at a prompt that has the word "list". It then answers "OK".
// `FAKE_VERSION` is the CLI version that it reports.
import { type AcpHandler, type AcpParams, type AcpRequest, logEntry, serveFakeAcpAgent } from "../acp-agent";

const MODELS = {
  availableModels: [{ modelId: "gemini-3-flash", name: "Gemini 3 Flash" }],
  currentModelId: "gemini-3-flash",
};
const servers = new Map<string, NonNullable<AcpParams["mcpServers"]>>();
let sessions = 0;

/** The number of tools in a JSON-RPC answer, or 0. The answer can come as JSON or as one SSE event. */
function toolCount(text: string): number {
  const answer: { result?: { tools?: readonly object[] } } = JSON.parse(
    text.startsWith("{") ? text : (/^data: (.*)$/mu.exec(text)?.[1] ?? "{}"),
  );
  return answer.result?.tools?.length ?? 0;
}

/** One JSON-RPC request to an http MCP server. Returns the number of tools that it answers. */
async function mcpRequest(server: NonNullable<AcpParams["mcpServers"]>[number], method: string, id: number) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  for (const header of server.headers ?? []) headers[header.name] = header.value;
  const params =
    method === "initialize"
      ? { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake-agy", version: "1" } }
      : {};
  const response = await fetch(server.url ?? "", {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  return toolCount(await response.text());
}

/** Lists the tools of OpenBot's servers of the session, and returns how many there are. */
async function listOpenBotTools(sessionId: string): Promise<number> {
  let count = 0;
  for (const server of servers.get(sessionId) ?? []) {
    if (server.type !== "http" || !server.name.startsWith("openbot")) continue;
    await mcpRequest(server, "initialize", 1);
    count += await mcpRequest(server, "tools/list", 2);
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
  const delay = mode === "late" ? Number(process.env.FAKE_LATE_MS ?? 0) : 0;
  setTimeout(() => void listOpenBotTools(sessionId).then(answer), delay);
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
    const finish = (listed: number | null) => {
      logEntry({ method: request.method, sessionId, listed });
      peer.say(sessionId, "OK");
      peer.reply(request, { stopReason: "end_turn" });
    };
    if (/\blist\b/u.test(text)) void listOpenBotTools(sessionId).then(finish);
    else finish(null);
  },
});
