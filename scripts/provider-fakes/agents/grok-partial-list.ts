import { readFileSync } from "node:fs";
import { type AcpPeer, type AcpRequest, logEntry, serveFakeAcpAgent } from "../acp-agent";

if (process.argv.includes("--version")) {
  process.stdout.write("grok 1.0.70\n");
  process.exit(0);
}

const BUILT_IN = [
  { modelId: "grok-4.6", name: "Grok 4.6" },
  { modelId: "grok-4.5", name: "Grok 4.5" },
];
const CATALOGUE = [{ modelId: "grok-4.7", name: "Grok 4.7" }, ...BUILT_IN];
const accountHome =
  process.env.FAKE_ACCOUNTS && process.env.GROK_HOME?.startsWith(process.env.FAKE_ACCOUNTS)
    ? process.env.GROK_HOME
    : null;
const control = JSON.parse(readFileSync(process.env.FAKE_CONTROL ?? "", "utf8"));
const partial = accountHome ? 0 : Number(control.partial) || 0;
const marksLists = control.markLists === true;
let setups = 0;
let count = 0;

function setup(request: AcpRequest, peer: AcpPeer, sessionId: string): void {
  setups += 1;
  const short = marksLists ? [...BUILT_IN, { modelId: `grok-list-${setups}`, name: `Grok list ${setups}` }] : BUILT_IN;
  const models = setups <= partial ? short : CATALOGUE;
  logEntry({
    event: "setup",
    pid: process.pid,
    setup: setups,
    account: accountHome,
    models: models.map((model) => model.modelId),
  });
  peer.reply(request, { sessionId, models: { availableModels: models, currentModelId: models[0]?.modelId } });
}

serveFakeAcpAgent({
  initialize: (request, peer) =>
    peer.reply(request, {
      protocolVersion: 1,
      agentInfo: { name: "grok", version: "1.0.70" },
      agentCapabilities: { loadSession: true },
      authMethods: [],
    }),
  "session/new": (request, peer) => {
    count += 1;
    setup(request, peer, `grok-${process.pid}-${count}`);
  },
  "session/load": (request, peer) => setup(request, peer, request.params.sessionId ?? ""),
  "session/resume": (request, peer) => setup(request, peer, request.params.sessionId ?? ""),
  "session/prompt": (request, peer) => {
    peer.say(request.params.sessionId, "ok");
    peer.reply(request, { stopReason: "end_turn" });
  },
});
