// The ACP agent of `provider-conformance-e2e.ts`. It acts as each ACP provider does in the cases that
// every provider must pass, and differs only where the real CLIs differ:
// - `FAKE_MISSING` names the error that `session/load` and `session/resume` give for a session that
//   the agent does not have (`gone-…`). Each form is the one that the provider's flavor recognizes.
// - `FAKE_SIGNED_OUT=1` refuses each new session, as an agent does before its sign-in.
// A prompt with the text `wait` runs until the client cancels it. Each other prompt answers at once.
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
  // The protocol's own error, which Grok, Cline and custom agents give.
  protocol: (sessionId) => ({ code: -32002, message: "Resource not found", data: { uri: sessionId } }),
  // OpenCode 2.x.
  opencode: (sessionId) => ({
    code: -32602,
    message: `Invalid params: session not found: ${sessionId}`,
    data: { sessionId },
  }),
  // Antigravity 1.3.0, on a load or a resume.
  antigravity: (sessionId) => ({ code: -32002, message: "Resource not found", data: { sessionId } }),
  // Cursor.
  cursor: (sessionId) => ({
    code: -32602,
    message: "Invalid params",
    data: { message: `Session "${sessionId}" not found` },
  }),
};

const missingError = MISSING_ERRORS[process.env.FAKE_MISSING ?? "protocol"];
const signedOut = process.env.FAKE_SIGNED_OUT === "1";
const models = new Map<string, string>();
/** The `wait` prompt of each session that waits for its cancel. */
const waiting = new Map<string, () => void>();
let count = 0;

function setup(sessionId: string) {
  const current = models.get(sessionId) ?? MODELS[0]?.modelId ?? "";
  models.set(sessionId, current);
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
    models: { availableModels: MODELS, currentModelId: current },
  };
}

function restore(request: AcpRequest, peer: AcpPeer): void {
  const sessionId = request.params.sessionId ?? "";
  logEntry({ event: request.method, sessionId });
  if (sessionId.startsWith("gone-") && missingError) peer.fail(request, missingError(sessionId));
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
        agentCapabilities: { loadSession: true },
        authMethods: [],
      }),
    "session/new": (request, peer) => {
      if (signedOut) {
        peer.fail(request, { code: -32000, message: "Authentication required" });
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
      peer.reply(request, { configOptions: setup(sessionId).configOptions });
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
