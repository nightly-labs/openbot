import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
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

async function listOpenBotTools(sessionId: string, partial = false): Promise<number> {
  let count = 0;
  for (const server of servers.get(sessionId) ?? []) {
    if (server.type !== "http" || (partial && server.name === "openbot")) continue;
    await mcpRequest(server, "initialize", 1);
    count += await mcpRequest(server, "tools/list", 2);
  }
  return count;
}

const open = (sessionId: string, request: AcpRequest, peer: Parameters<AcpHandler>[1]) => {
  servers.set(sessionId, request.params.mcpServers ?? []);
  const mode = request.params.mcpServers?.length ? (process.env.FAKE_OPEN_LIST ?? "now") : "now";
  const answer = (listed: number | null) => {
    logEntry({ method: request.method, sessionId, mode, listed });
    peer.reply(request, request.method === "session/new" ? { sessionId, models: MODELS } : { models: MODELS });
  };
  if (mode === "never") return answer(null);
  void (async () => {
    if (mode === "concurrent") logEntry({ method: "cache/start", sessionId });
    const listed = await listOpenBotTools(sessionId, mode === "partial");
    if (mode === "preload-failure") {
      const logFile = process.argv.find((arg) => arg.startsWith("--log-file="))?.slice("--log-file=".length);
      if (!logFile) throw new Error("The session worker did not receive its own log.");
      mkdirSync(dirname(logFile), { recursive: true });
      appendFileSync(
        logFile,
        "session_handlers.go:396] Failed to preload the session's MCP servers: context deadline exceeded\n",
      );
    }
    if (mode === "concurrent") logEntry({ method: "cache/end", sessionId });
    answer(listed);
  })();
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
