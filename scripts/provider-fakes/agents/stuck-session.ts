// The ACP agent of `acp-stuck-starting-e2e.ts`. `FAKE_CONTROL` is a JSON file `{ "mode" }`.
// `ok` answers load and resume. `store-miss` writes the Chisel log line and does not answer.
// `chisel-error` answers `-32016` `Session not found`. `hang` does not answer and does not log.
// `session/new` always opens a session, so a missing stored session can be replaced.
import { readFileSync } from "node:fs";
import { type AcpParams, type AcpPeer, type AcpRequest, logEntry, serveFakeAcpAgent } from "../acp-agent";

type Mode = "ok" | "store-miss" | "chisel-error" | "hang";

function mode(): Mode {
  try {
    const value = JSON.parse(readFileSync(process.env.FAKE_CONTROL ?? "", "utf8")).mode;
    if (value === "store-miss" || value === "chisel-error" || value === "hang") return value;
  } catch {
    // A missing file is a healthy agent.
  }
  return "ok";
}

let sessions = 0;
const MODELS = [{ modelId: "default", name: "Fixture" }];

function setup(sessionId: string) {
  return {
    sessionId,
    models: { availableModels: MODELS, currentModelId: "default" },
    configOptions: [
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "default",
        options: [{ value: "default", name: "Fixture" }],
      },
    ],
  };
}

function promptText(params: AcpParams): string {
  return (params.prompt ?? []).map((block) => block.text ?? "").join("");
}

function restore(request: AcpRequest, peer: AcpPeer): void {
  const sessionId = request.params.sessionId ?? "";
  const current = mode();
  logEntry({ event: request.method, sessionId, mode: current });
  if (current === "store-miss") {
    process.stderr.write(`ERROR chisel_agent::acp_server::agent_impl: ACP: session ${sessionId} not found in store\n`);
    return;
  }
  if (current === "chisel-error") {
    peer.fail(request, { code: -32016, message: "Session not found" });
    return;
  }
  if (current === "hang") return;
  peer.reply(request, setup(sessionId));
}

serveFakeAcpAgent({
  initialize: (request, peer) =>
    peer.reply(request, {
      protocolVersion: 1,
      agentInfo: { name: "stuck-session", version: "1.0.0" },
      agentCapabilities: { loadSession: true },
      authMethods: [],
    }),
  "session/new": (request, peer) => {
    sessions += 1;
    const sessionId = `s-${process.pid}-${sessions}`;
    logEntry({ event: "session/new", sessionId, mode: mode() });
    peer.reply(request, setup(sessionId));
  },
  "session/load": restore,
  "session/resume": restore,
  "session/set_config_option": (request, peer) => {
    peer.reply(request, { configOptions: setup(request.params.sessionId ?? "").configOptions });
  },
  "session/prompt": (request, peer) => {
    const sessionId = request.params.sessionId ?? "";
    logEntry({ event: "session/prompt", sessionId, text: promptText(request.params) });
    peer.say(sessionId, "Fixture answer.");
    peer.reply(request, { stopReason: "end_turn" });
  },
});
