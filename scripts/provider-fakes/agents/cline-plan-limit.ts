import { logEntry, serveFakeAcpAgent } from "../acp-agent";

if (process.argv.includes("--version")) {
  process.stdout.write("3.0.74\n");
  process.exit(0);
}

const LIMIT = "You have reached your weekly Clinepass limit. The limit resets in 8h 30m, please try again later.";
const SPENT = new Set((process.env.FAKE_SPENT_MODELS ?? "").split(",").filter(Boolean));
const MODELS = (process.env.FAKE_MODELS ?? "").split(",").filter(Boolean);
const LISTED = MODELS.map((modelId) => ({ modelId, name: modelId }));
const models = new Map<string, string>();
let count = 0;

function configOptions(model: string) {
  return [
    {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: model,
      options: LISTED.map((entry) => ({ value: entry.modelId, name: entry.name })),
    },
  ];
}

serveFakeAcpAgent({
  initialize: (request, peer) =>
    peer.reply(request, {
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } },
      authMethods: [],
    }),
  "session/new": (request, peer) => {
    count += 1;
    const sessionId = `cline-${process.pid}-${count}`;
    const model = MODELS[0] ?? "";
    models.set(sessionId, model);
    peer.reply(request, {
      sessionId,
      configOptions: configOptions(model),
      models: { availableModels: LISTED, currentModelId: model },
    });
  },
  "session/resume": (request, peer) => {
    const sessionId = request.params.sessionId ?? "";
    const model = models.get(sessionId) ?? MODELS[0] ?? "";
    models.set(sessionId, model);
    peer.reply(request, {
      configOptions: configOptions(model),
      models: { availableModels: LISTED, currentModelId: model },
    });
  },
  "session/set_config_option": (request, peer) => {
    const { sessionId = "", configId, value = "" } = request.params;
    if (configId === "model") models.set(sessionId, value);
    peer.reply(request, { configOptions: configOptions(models.get(sessionId) ?? "") });
  },
  "session/set_model": (request, peer) => {
    models.set(request.params.sessionId ?? "", request.params.modelId ?? "");
    peer.reply(request, {});
  },
  "session/prompt": (request, peer) => {
    const sessionId = request.params.sessionId;
    const model = models.get(sessionId ?? "") ?? "";
    const text = (request.params.prompt ?? []).map((block) => block.text ?? "").join("");
    const spent = SPENT.has(model) && text.includes("LIMIT-NOW");
    logEntry({ event: "prompt", sessionId, model, spent, text });
    if (spent) {
      peer.fail(request, { code: -32603, message: "Internal error", data: { details: LIMIT } });
      return;
    }
    peer.say(sessionId, "Done.");
    peer.reply(request, { stopReason: "end_turn" });
  },
});
