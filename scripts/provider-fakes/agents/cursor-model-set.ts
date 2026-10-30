// The `cursor-agent acp` of `cursor-model-set-e2e.ts`. As Cursor 2026.10.22-27dcf5f does, the model
// belongs to the process: a model set moves every session to it, and the agent sends no update for
// the other sessions. Each set is logged to `FAKE_LOG`. While the file named in `FAKE_FAIL_NEXT_SET`
// exists, the next model set fails as Cursor's does when its model list request fails (#3800), and
// the file is removed. While the file named in `FAKE_REORDER_SETS` exists, a set applies when it
// arrives, and the first of two overlapping sets answers last: Cursor answers each set after a server
// request of its own, so answers can come in another order than the sets applied.
import { existsSync, rmSync } from "node:fs";
import { type AcpRequest, logEntry, serveFakeAcpAgent } from "../acp-agent";

const MODELS = [
  { value: "gpt-5.6-sol[context=272k,reasoning=medium,fast=false]", name: "GPT-5.6 Sol" },
  { value: "gpt-5.6-sol[context=272k,reasoning=high,fast=false]", name: "GPT-5.6 Sol High" },
];

let current = MODELS[0]?.value ?? "";
let count = 0;
let setsInFlight = 0;

const configOptions = () => [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: current,
    options: MODELS,
  },
];

const failNextSet = (request: AcpRequest): boolean => {
  const path = process.env.FAKE_FAIL_NEXT_SET;
  if (!path || !existsSync(path)) return false;
  rmSync(path);
  logEntry({ method: request.method, value: request.params.value, failed: true });
  return true;
};

serveFakeAcpAgent({
  initialize: (request, peer) =>
    peer.reply(request, { protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [] }),
  "session/new": (request, peer) => {
    count += 1;
    peer.reply(request, {
      sessionId: `s-${process.pid}-${count}`,
      configOptions: configOptions(),
      models: {
        availableModels: MODELS.map((model) => ({ modelId: model.value, name: model.name })),
        currentModelId: current,
      },
    });
  },
  "session/set_config_option": (request, peer) => {
    const value = request.params.value ?? "";
    if (failNextSet(request)) {
      peer.fail(request, {
        code: -32602,
        message: "Invalid params",
        data: { message: `Invalid model value: ${value}` },
      });
      return;
    }
    logEntry({ method: request.method, value });
    current = value;
    const reorder = process.env.FAKE_REORDER_SETS;
    if (!reorder || !existsSync(reorder)) {
      peer.reply(request, { configOptions: configOptions() });
      return;
    }
    const delayMs = setsInFlight === 0 ? 500 : 100;
    setsInFlight += 1;
    setTimeout(() => {
      setsInFlight -= 1;
      peer.reply(request, { configOptions: configOptions() });
    }, delayMs);
  },
  "session/prompt": (request, peer) => {
    peer.say(request.params.sessionId, `Model: ${current}`);
    peer.reply(request, { stopReason: "end_turn" });
  },
});
