import { readFileSync } from "node:fs";
import { type AcpPeer, type AcpRequest, logEntry, serveFakeAcpAgent } from "../acp-agent";

if (process.argv.includes("--version")) {
  process.stdout.write("1.5.9\n");
  process.exit(0);
}

const FIRST = [
  { modelId: "gemini-4-hydrogen", name: "Gemini 4 Hydrogen" },
  { modelId: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
];
const CATALOGUE = [...FIRST, { modelId: "gemini-4-neon", name: "Gemini 4 Neon" }];
const control = JSON.parse(readFileSync(process.env.FAKE_CONTROL ?? "", "utf8"));
const partial = Number(control.partial) || 0;
const marksLists = control.markLists === true;
let setups = 0;
let count = 0;

function setup(request: AcpRequest, peer: AcpPeer, sessionId: string): void {
  setups += 1;
  const short = marksLists ? [...FIRST, { modelId: `gemini-list-${setups}`, name: `Gemini list ${setups}` }] : FIRST;
  const models = setups <= partial ? short : CATALOGUE;
  logEntry({ event: "setup", pid: process.pid, setup: setups, models: models.map((model) => model.modelId) });
  peer.reply(request, { sessionId, models: { availableModels: models, currentModelId: models[0]?.modelId } });
}

serveFakeAcpAgent({
  initialize: (request, peer) =>
    peer.reply(request, {
      protocolVersion: 1,
      agentInfo: { name: "Antigravity ACP Server", version: "1.5.9" },
      agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } },
      authMethods: [],
    }),
  "session/new": (request, peer) => {
    count += 1;
    setup(request, peer, `agy-${process.pid}-${count}`);
  },
  "session/load": (request, peer) => setup(request, peer, request.params.sessionId ?? ""),
  "session/resume": (request, peer) => setup(request, peer, request.params.sessionId ?? ""),
  "session/prompt": (request, peer) => {
    peer.say(request.params.sessionId, "ok");
    peer.reply(request, { stopReason: "end_turn" });
  },
});
