import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type AcpHandler, type AcpRequest, logEntry, serveFakeAcpAgent } from "../acp-agent";

const MODELS = {
  availableModels: [{ modelId: "gemini-3-flash", name: "Gemini 3 Flash" }],
  currentModelId: "gemini-3-flash",
};
const flag = (name: string) => process.argv.find((arg) => arg.startsWith(name))?.slice(name.length) ?? "";
const appData = join(flag("--gemini-dir="), flag("--app-data-dir="));
const folder = join(appData, "log");
mkdirSync(folder, { recursive: true });
const logFile = join(folder, `acp-server-20261111_000000-${process.pid}.log`);
const log = (line: string) => appendFileSync(logFile, `${line}\n`);
log(`I1111 00:00:00.000000       1 options.go:485] Starting ACP server (pid ${process.pid})`);

interface SavedTool {
  name: string;
  parameters: { type: "object"; properties: object };
}

const SCHEMAS: Partial<Record<string, SavedTool[]>> = {
  ticktick: [
    { name: "list_tasks", parameters: { type: "object", properties: { tags: { type: "array" } } } },
    {
      name: "get_task",
      parameters: { type: "object", properties: { status: { type: "string", enum: ["open", ""] } } },
    },
  ],
  bling: [
    {
      name: "listAccountReceivables",
      parameters: {
        type: "object",
        properties: { situacoes: { type: "string", enum: ["1", "2"], items: { type: "integer" } } },
      },
    },
  ],
  aave: [
    {
      name: "get_reserve_holders",
      parameters: { type: "object", properties: { limit: { type: "number", enum: [10, 50] } } },
    },
  ],
  openmotion: [
    {
      name: "openmotion_restore_version",
      parameters: { type: "object", properties: { presentation: { enum: ["slides", "video"] } } },
    },
  ],
  atlas: [
    { name: "search", parameters: { type: "object", properties: { tags: { type: "string" } } } },
    {
      name: "receivables",
      parameters: { type: "object", properties: { situacoes: { type: "array", items: { type: "integer" } } } },
    },
    {
      name: "top_holders",
      parameters: { type: "object", properties: { limit: { type: "string", enum: ["10", "50"] } } },
    },
  ],
};
const FAILURES: Record<string, string> = {
  KEY: "generating and executing: Error 400, Message: API key not valid. Please pass a valid API key., Status: INVALID_ARGUMENT, Details: [map[@type:type.googleapis.com/google.rpc.ErrorInfo reason:API_KEY_INVALID]]",
  OTHER: "creating trajectory: unexpected step state 7",
  QUIET: "",
};
const GOOGLE_REFUSALS: Partial<Record<string, string>> = {
  ticktick: [
    "* GenerateContentRequest.tools[20].function_declarations[0].parameters.properties[tags].items: missing field.",
    "* GenerateContentRequest.tools[21].function_declarations[0].parameters.properties[status].enum[1]: cannot be empty",
  ].join("\n"),
  bling:
    "* GenerateContentRequest.tools[20].function_declarations[0].parameters.properties[situacoes].items: field predicate failed: $type == Type.ARRAY",
  openmotion:
    "Unable to submit request because `mcp_openmotion_openmotion_restore_version` functionDeclaration `parameters.presentation` schema didn't specify the schema type field. Learn more: https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/function-calling",
  aave: [
    "* GenerateContentRequest.tools[23].function_declarations[0].parameters.properties[limit].enum[0]: cannot be empty",
    "* GenerateContentRequest.tools[23].function_declarations[0].parameters.properties[limit].enum[1]: cannot be empty",
  ].join("\n"),
};

const started = new Map<string, string[]>();
const answered = new Map<string, number>();
let sessions = 0;
const openedWith = (sessionId: string) => join(appData, "sessions", sessionId);

function record(request: AcpRequest, sessionId: string): void {
  const names = (request.params.mcpServers ?? []).map((server) => server.name);
  if (!started.has(sessionId)) started.set(sessionId, names);
  for (const name of names) {
    for (const schema of SCHEMAS[name] ?? []) {
      mkdirSync(join(appData, "mcp", name), { recursive: true });
      writeFileSync(join(appData, "mcp", name, `${schema.name}.json`), JSON.stringify(schema));
    }
  }
  logEntry({ method: request.method, sessionId, pid: process.pid, names });
}

const resume: AcpHandler = (request, peer) => {
  record(request, request.params.sessionId ?? "");
  peer.reply(request, { models: MODELS });
};

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
    record(request, sessionId);
    mkdirSync(join(appData, "sessions"), { recursive: true });
    writeFileSync(openedWith(sessionId), (started.get(sessionId) ?? []).join("\n"));
    peer.reply(request, { sessionId, models: MODELS });
  },
  "session/resume": resume,
  "session/load": resume,
  "session/prompt": (request, peer) => {
    const sessionId = request.params.sessionId ?? "";
    const text = (request.params.prompt ?? []).map((block) => block.text ?? "").join("");
    log(`I1111 00:00:00.100000     218 server.go:1817] Sending user message to conversation ${sessionId} (items=1)`);
    const prompts = answered.get(sessionId) ?? 0;
    answered.set(sessionId, prompts + 1);
    const returned =
      text.includes("SERVERS_RETURN") &&
      prompts > 0 &&
      existsSync(openedWith(sessionId)) &&
      readFileSync(openedWith(sessionId), "utf8").split("\n").includes("resend");
    const refused =
      /REFUSE_TOOL=(\S+)/u.exec(text)?.[1] ??
      (started.get(sessionId)?.includes("resend") || returned ? "mcp_resend_get-contact" : null);
    const googleRefused = refused ? undefined : started.get(sessionId)?.find((name) => GOOGLE_REFUSALS[name]);
    logEntry({ method: request.method, sessionId, pid: process.pid, refused: googleRefused ?? refused });
    const failure = googleRefused
      ? `agent executor error: generating and executing: Error 400, Message: ${GOOGLE_REFUSALS[googleRefused]}, Status: INVALID_ARGUMENT`
      : `agent executor error: building toolbox: tool "${refused}" advertises an invalid parameter schema: "schema://tool-parameters.json#" is not valid against metaschema`;
    const own = FAILURES[/\bFAIL_(KEY|OTHER|QUIET)\b/u.exec(text)?.[1] ?? ""];
    if (own !== undefined) {
      if (own) log(`E1111 00:00:00.200000     294 errorreport.go:273] agent executor error: ${own}`);
      peer.say(sessionId, "\n⚠ Agent execution terminated due to error.\n");
    } else if ((refused || googleRefused) && text.includes("CLI_1_5_9")) peer.say(sessionId, `\n⚠ ${failure}\n`);
    else if (refused || googleRefused) {
      log(`E1111 00:00:00.200000     294 errorreport.go:273] ${failure}`);
      peer.say(sessionId, "\n⚠ Agent execution terminated due to error.\n");
    } else peer.say(sessionId, "OK");
    peer.reply(request, { stopReason: "end_turn" });
  },
});
