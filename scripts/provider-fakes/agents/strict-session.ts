import { type AcpPeer, type AcpRequest, logEntry, serveFakeAcpAgent } from "../acp-agent";

const MODELS = [{ modelId: "fake-alpha", name: "Fake Alpha" }];
const closes = process.env.FAKE_CLOSE === "1";
const resumes = process.env.FAKE_RESUME === "1";
const hangMs = Number(process.env.FAKE_HANG_MS ?? 0);
const refusal = process.env.FAKE_REFUSAL;
const refusesWithReason = refusal === "reason" || refusal === "busy";
const active = new Set<string>();
const open = new Map<string, { request: AcpRequest; peer: AcpPeer }>();
let count = 0;

function setup(sessionId: string) {
  return {
    sessionId,
    configOptions: [
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "fake-alpha",
        options: MODELS.map((model) => ({ value: model.modelId, name: model.name })),
      },
    ],
    models: { availableModels: MODELS, currentModelId: "fake-alpha" },
  };
}

function endPrompt(sessionId: string, stopReason: string): void {
  const prompt = open.get(sessionId);
  if (!prompt) return;
  open.delete(sessionId);
  logEntry({ event: "prompt-ended", sessionId, text: stopReason });
  prompt.peer.reply(prompt.request, { stopReason });
}

function restore(request: AcpRequest, peer: AcpPeer): void {
  const sessionId = request.params.sessionId ?? "";
  const refused = active.has(sessionId);
  logEntry({ event: request.method, sessionId, text: refused ? "refused" : "opened" });
  if (refused) {
    peer.fail(
      request,
      refusesWithReason
        ? {
            code: -32901,
            message: "The session is busy.",
            data: { reason: refusal === "busy" && open.has(sessionId) ? "session_busy" : "session_already_open" },
          }
        : { code: -32602, message: "Invalid params", data: `session is already active: ${sessionId}` },
    );
    return;
  }
  active.add(sessionId);
  peer.reply(request, setup(sessionId));
}

serveFakeAcpAgent(
  {
    initialize: (request, peer) =>
      peer.reply(request, {
        protocolVersion: 1,
        agentInfo: { name: "strict-session", version: "1.0.0" },
        agentCapabilities: {
          loadSession: true,
          sessionCapabilities: { ...(closes ? { close: {} } : {}), ...(resumes ? { resume: {} } : {}) },
        },
        authMethods: [],
      }),
    "session/new": (request, peer) => {
      count += 1;
      const sessionId = `strict-${process.pid}-${count}`;
      active.add(sessionId);
      logEntry({ event: "session/new", sessionId });
      peer.reply(request, setup(sessionId));
    },
    "session/load": restore,
    "session/resume": restore,
    "session/close": (request, peer) => {
      const sessionId = request.params.sessionId ?? "";
      logEntry({ event: "session/close", sessionId, text: closes ? "closed" : "refused" });
      if (!closes) {
        peer.fail(request, { code: -32601, message: "Method not found" });
        return;
      }
      endPrompt(sessionId, "cancelled");
      active.delete(sessionId);
      peer.reply(request, {});
    },
    "session/set_config_option": (request, peer) =>
      peer.reply(request, { configOptions: setup(request.params.sessionId ?? "").configOptions }),
    "session/prompt": (request, peer) => {
      const sessionId = request.params.sessionId ?? "";
      const text = (request.params.prompt ?? []).map((block) => block.text ?? "").join("");
      const hang = /\bhang\b/u.test(text);
      logEntry({ event: "prompt", sessionId, text: hang ? "hang" : "hello" });
      if (open.has(sessionId)) {
        peer.fail(
          request,
          refusesWithReason
            ? { code: -32901, message: "The session is busy.", data: { reason: "session_busy" } }
            : { code: -32600, message: "Invalid request", data: "a prompt is already active" },
        );
        return;
      }
      if (hang) {
        open.set(sessionId, { request, peer });
        if (hangMs > 0) setTimeout(() => endPrompt(sessionId, "end_turn"), hangMs);
        return;
      }
      peer.say(sessionId, "ok");
      peer.reply(request, { stopReason: "end_turn" });
    },
  },
  {
    onNotification: (method, params) => {
      if (method === "session/cancel") logEntry({ event: "cancel", sessionId: params.sessionId ?? "" });
    },
  },
);
