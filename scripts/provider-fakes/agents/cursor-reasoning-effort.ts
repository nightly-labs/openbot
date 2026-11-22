// The `cursor-agent acp` of `cursor-reasoning-effort-e2e.ts`. Models are base ids. There is no
// `thought_level`. A `reasoning` select appears only after that model is selected: Composer offers
// medium, and DeepSeek offers low, medium, high and xhigh. `fast` is a boolean on every answer.
import { logEntry, serveFakeAcpAgent } from "../acp-agent";

const MODELS = [
  { value: "composer-2.5", name: "Composer 2.5" },
  { value: "deepseek-v4", name: "DeepSeek" },
] as const;

type ModelId = (typeof MODELS)[number]["value"];

const REASONING: Record<ModelId, readonly string[]> = {
  "composer-2.5": ["medium"],
  "deepseek-v4": ["none", "low", "medium", "high", "max"],
};

let model: ModelId = "composer-2.5";
let fast = false;
let reasoning = "medium";
let count = 0;

const isModelId = (value: string): value is ModelId => MODELS.some((entry) => entry.value === value);

const configOptions = (withReasoning: boolean) => [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: model,
    options: MODELS.map((entry) => ({ value: entry.value, name: entry.name })),
  },
  {
    id: "fast",
    name: "Fast",
    category: "mode",
    type: "boolean",
    currentValue: fast,
  },
  ...(withReasoning
    ? [
        {
          id: "reasoning",
          name: "Reasoning",
          category: "session",
          type: "select",
          currentValue: reasoning,
          options: REASONING[model].map((value) => ({ value, name: value })),
        },
      ]
    : []),
];

function optionValue(params: { value?: string | boolean }): string {
  if (typeof params.value === "boolean") return params.value ? "true" : "false";
  return params.value ?? "";
}

serveFakeAcpAgent({
  initialize: (request, peer) =>
    peer.reply(request, { protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [] }),
  "session/new": (request, peer) => {
    count += 1;
    peer.reply(request, {
      sessionId: `s-${process.pid}-${count}`,
      configOptions: configOptions(false),
      models: {
        availableModels: MODELS.map((entry) => ({ modelId: entry.value, name: entry.name })),
        currentModelId: model,
      },
    });
  },
  "session/set_config_option": (request, peer) => {
    const configId = request.params.configId ?? "";
    const value = optionValue(request.params);
    logEntry({ method: request.method, configId, value });
    if (configId === "model" && isModelId(value) && value !== model) {
      model = value;
      reasoning = "medium";
    } else if (configId === "fast") {
      fast = value === "true";
    } else if (configId === "reasoning" && REASONING[model].includes(value)) {
      reasoning = value;
    }
    peer.reply(request, { configOptions: configOptions(true) });
  },
  "session/prompt": (request, peer) => {
    peer.say(request.params.sessionId, `Model: ${model} Reasoning: ${reasoning}`);
    peer.reply(request, { stopReason: "end_turn" });
  },
});
