// The Grok agent of `grok-partial-model-list-e2e.ts`. Each session setup lists the models, as Grok
// 1.0.70 does. The first `partial` setups of a process list only the two built-in models: Grok starts
// on them while it renews an expired sign-in, and has its whole catalogue about a second later. Each
// later setup lists all three. `partial` is read from the JSON file in `FAKE_CONTROL` when the process
// starts, so the test sets it before it restarts the provider.
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
const partial = Number(JSON.parse(readFileSync(process.env.FAKE_CONTROL ?? "", "utf8")).partial) || 0;
let setups = 0;
let count = 0;

function setup(request: AcpRequest, peer: AcpPeer, sessionId: string): void {
  setups += 1;
  const models = setups <= partial ? BUILT_IN : CATALOGUE;
  logEntry({ event: "setup", pid: process.pid, setup: setups, models: models.map((model) => model.modelId) });
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
