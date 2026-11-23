import {
  type AcpError,
  type AcpParams,
  type AcpPeer,
  type AcpRequest,
  logEntry,
  serveFakeAcpAgent,
} from "../acp-agent";

const MODELS = [
  { modelId: "fake-alpha", name: "Fake Alpha" },
  { modelId: "fake-beta", name: "Fake Beta" },
];

const MISSING_ERRORS: Readonly<Partial<Record<string, (sessionId: string) => AcpError>>> = {
  protocol: (sessionId) => ({ code: -32002, message: "Resource not found", data: { uri: sessionId } }),
  opencode: (sessionId) => ({
    code: -32602,
    message: `Invalid params: session not found: ${sessionId}`,
    data: { sessionId },
  }),
  antigravity: (sessionId) => ({
    code: -32603,
    message: `Failed to read session ${sessionId}; retry, or load it with session/load`,
  }),
  kimi: () => ({ code: -32602, message: "Invalid params", data: { session_id: "Session not found" } }),
  devin: () => ({
    code: -32016,
    message: "Session not found",
    data: { "cognition.ai/errorKind": "session_not_found", "cognition.ai/retryable": false },
  }),
  mistral: (sessionId) => ({
    code: -32602,
    message: `Session not found: ${sessionId}`,
    data: { session_id: sessionId },
  }),
  cline: (sessionId) => ({
    code: -32603,
    message: "Internal error",
    data: { details: `session not found: ${sessionId}` },
  }),
  cursor: (sessionId) => ({
    code: -32602,
    message: "Invalid params",
    data: { message: `Session "${sessionId}" not found` },
  }),
};

const hermes = process.env.FAKE_MISSING === "hermes";
const antigravity = process.env.FAKE_MISSING === "antigravity";
const devin = process.env.FAKE_MISSING === "devin";
const mistral = process.env.FAKE_MISSING === "mistral";
const HERMES_AUTH_METHODS = [
  { id: "nous", name: "nous runtime credentials" },
  { id: "hermes-setup", name: "Configure Hermes provider", type: "terminal", args: ["--setup"] },
];
const missingError = MISSING_ERRORS[process.env.FAKE_MISSING ?? "protocol"];
const signedOut = process.env.FAKE_SIGNED_OUT === "1";
const kimiModelSet = process.env.FAKE_MODEL_SET === "kimi";
const mistralModelSet = process.env.FAKE_MODEL_SET === "mistral";
const kiroModelSet = process.env.FAKE_MODEL_SET === "kiro";
const models = new Map<string, string>();
const waiting = new Map<string, () => void>();
let count = 0;

function setup(sessionId: string) {
  const current = models.get(sessionId) ?? MODELS[0]?.modelId ?? "";
  models.set(sessionId, current);
  const state = { availableModels: MODELS, currentModelId: current };
  if (kimiModelSet) return { sessionId, models: state };
  return {
    sessionId,
    configOptions: [
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: current,
        options: MODELS.map((model) => ({ value: model.modelId, name: model.name })),
      },
    ],
    models: kiroModelSet ? undefined : state,
    modes: hermes ? { currentModeId: "default", availableModes: [{ id: "default", name: "Default" }] } : undefined,
  };
}

function restore(request: AcpRequest, peer: AcpPeer): void {
  const sessionId = request.params.sessionId ?? "";
  logEntry({ event: request.method, sessionId });
  if (sessionId.startsWith("gone-") && hermes) {
    count += 1;
    peer.reply(
      request,
      request.method === "session/load" ? null : { ...setup(`s-${process.pid}-${count}`), sessionId: undefined },
    );
  } else if (sessionId.startsWith("gone-") && missingError) peer.fail(request, missingError(sessionId));
  else peer.reply(request, setup(sessionId));
}

function promptText(params: AcpParams): string {
  return (params.prompt ?? []).map((block) => block.text ?? "").join("");
}

serveFakeAcpAgent(
  {
    initialize: (request, peer) =>
      peer.reply(request, {
        protocolVersion: 1,
        agentInfo: { name: "conformance", version: "1.0.0" },
        agentCapabilities: {
          loadSession: true,
          ...(hermes || antigravity ? { sessionCapabilities: { resume: {} } } : {}),
        },
        authMethods: hermes ? HERMES_AUTH_METHODS.filter((method) => !signedOut || method.id === "hermes-setup") : [],
      }),
    "session/new": (request, peer) => {
      if (signedOut && hermes) {
        process.stderr.write(
          "2026-11-02 10:00:00,000 [WARNING] agent.auxiliary_client: resolve_provider_client: nous requested but Nous Portal not configured (run: hermes auth)\n",
        );
        peer.fail(request, { code: -32603, message: "Internal error" });
        return;
      }
      if (signedOut && devin) {
        count += 1;
        const sessionId = `s-${process.pid}-${count}`;
        peer.reply(request, { sessionId, configOptions: [], models: { availableModels: [], currentModelId: "" } });
        return;
      }
      if (signedOut) {
        const message = mistral ? "Missing API key for mistral provider." : "Authentication required";
        peer.fail(request, { code: -32000, message });
        return;
      }
      count += 1;
      peer.reply(request, setup(`s-${process.pid}-${count}`));
    },
    "session/load": restore,
    "session/resume": restore,
    "session/set_config_option": (request, peer) => {
      const { sessionId = "", configId, value = "" } = request.params;
      logEntry({ event: "set", sessionId, configId, value });
      if (configId === "model") models.set(sessionId, value);
      if (mistralModelSet)
        peer.fail(request, {
          code: -32602,
          message: "Layer 'user-toml': cannot write config file at /home/user/.vibe/config.toml",
          data: null,
        });
      else peer.reply(request, { configOptions: setup(sessionId).configOptions });
    },
    "session/set_model": (request, peer) => {
      const { sessionId = "", modelId = "" } = request.params;
      logEntry({ event: "set_model", sessionId, value: modelId });
      if (kiroModelSet) {
        peer.fail(request, {
          code: -32603,
          message: '[PersistenceClassification] Ext method "session/set_model" has no persistence classification',
        });
        return;
      }
      models.set(sessionId, modelId);
      if (!kimiModelSet) peer.reply(request, {});
      else
        peer.fail(request, {
          code: -32603,
          message: "Internal error",
          data: { details: "[Errno 1] Operation not permitted: '/home/user/.kimi/config.toml'" },
        });
    },
    "session/prompt": (request, peer) => {
      const sessionId = request.params.sessionId ?? "";
      const text = promptText(request.params);
      logEntry({ event: "prompt", sessionId, model: models.get(sessionId) ?? null, text });
      if (text.trim() === "wait") {
        waiting.set(sessionId, () => peer.reply(request, { stopReason: "cancelled" }));
        return;
      }
      peer.say(sessionId, `ok ${models.get(sessionId) ?? ""}`);
      peer.reply(request, { stopReason: "end_turn" });
    },
  },
  {
    onNotification: (method, params) => {
      if (method !== "session/cancel") return;
      const sessionId = params.sessionId ?? "";
      logEntry({ event: "cancel", sessionId });
      waiting.get(sessionId)?.();
      waiting.delete(sessionId);
    },
  },
);
