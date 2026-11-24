import { type AcpParams, type AcpPeer, type AcpRequest, logEntry, serveFakeAcpAgent } from "../acp-agent";

const MODELS = [{ modelId: "fake-alpha", name: "Fake Alpha" }];
const toolMs = Number(process.env.FAKE_TOOL_MS ?? 0);
const chunkGapMs = Number(process.env.FAKE_CHUNK_GAP_MS ?? 0);
const quietMs = Number(process.env.FAKE_QUIET_MS ?? 0);
const retryMs = Number(process.env.FAKE_RETRY_MS ?? 0);
const rateRetryMs = Number(process.env.FAKE_RATE_RETRY_MS ?? 0);
const loadSession = process.env.FAKE_NO_LOAD !== "1";
const silentNew = process.env.FAKE_SILENT_NEW === "1";
const sessionCapabilities = process.env.FAKE_RESUME === "1" ? { sessionCapabilities: { resume: {} } } : {};
const resumed = new Set<string>();
let count = 0;

function retryNotice(
  peer: AcpPeer,
  sessionId: string,
  attempt: number | null,
  message = "Timed out waiting for response headers",
): void {
  const retry = attempt === null ? null : { attempt, error: { message } };
  peer.update(sessionId, { sessionUpdate: "session_info_update", _meta: { "opencode/retry": retry } });
}

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

function restore(request: AcpRequest, peer: AcpPeer): void {
  const sessionId = request.params.sessionId ?? "";
  logEntry({ event: request.method, sessionId });
  if (request.method === "session/resume") resumed.add(sessionId);
  peer.reply(request, setup(sessionId));
}

function promptText(params: AcpParams): string {
  const text = (params.prompt ?? []).map((block) => block.text ?? "").join("");
  return text.replace(/^[\s\S]*<\/openbot-developer-instructions>/u, "");
}

serveFakeAcpAgent(
  {
    initialize: (request, peer) =>
      peer.reply(request, {
        protocolVersion: 1,
        agentInfo: { name: "stall", version: "1.0.0" },
        agentCapabilities: { loadSession, ...sessionCapabilities },
        authMethods: [],
      }),
    "session/new": (request, peer) => {
      count += 1;
      logEntry({ event: "session/new" });
      if (silentNew && count > 1) return;
      peer.reply(request, setup(`s-${process.pid}-${count}`));
    },
    "session/load": restore,
    "session/resume": restore,
    "session/set_config_option": (request, peer) =>
      peer.reply(request, { configOptions: setup(request.params.sessionId ?? "").configOptions }),
    "session/prompt": (request, peer) => {
      const sessionId = request.params.sessionId ?? "";
      const text = promptText(request.params).trim();
      logEntry({ event: "prompt", sessionId, text });
      if (text === "hang") return;
      if (text === "hang-once" && !resumed.has(sessionId)) {
        peer.update(sessionId, { sessionUpdate: "available_commands_update", availableCommands: [] });
        return;
      }
      if (text === "retry-once") {
        setTimeout(() => {
          retryNotice(peer, sessionId, 2);
          setTimeout(() => {
            peer.say(sessionId, "ok");
            peer.reply(request, { stopReason: "end_turn" });
          }, retryMs);
        }, retryMs);
        return;
      }
      if (text === "retry-forever") {
        for (let attempt = 2; attempt <= 7; attempt += 1)
          setTimeout(
            () => {
              if (attempt > 2) retryNotice(peer, sessionId, null);
              retryNotice(peer, sessionId, attempt);
            },
            retryMs * (attempt - 1),
          );
        return;
      }
      if (text === "retry-rate-limit") {
        for (let attempt = 2; attempt <= 4; attempt += 1)
          setTimeout(
            () => {
              if (attempt > 2) retryNotice(peer, sessionId, null);
              retryNotice(peer, sessionId, attempt, "Rate limit exceeded");
            },
            rateRetryMs * (attempt - 1),
          );
        setTimeout(() => {
          peer.say(sessionId, "ok");
          peer.reply(request, { stopReason: "end_turn" });
        }, rateRetryMs * 3.5);
        return;
      }
      if (text === "quiet") {
        peer.say(sessionId, "working");
        setTimeout(() => {
          peer.say(sessionId, ", done");
          peer.reply(request, { stopReason: "end_turn" });
        }, quietMs);
        return;
      }
      if (text === "tool-hang") {
        peer.update(sessionId, {
          sessionUpdate: "tool_call",
          toolCallId: "tool-hang-1",
          title: "Read design file",
          kind: "other",
          status: "in_progress",
        });
        return;
      }
      if (text === "tool") {
        peer.update(sessionId, {
          sessionUpdate: "tool_call",
          toolCallId: "tool-1",
          title: "Long build",
          kind: "execute",
          status: "in_progress",
        });
        setTimeout(() => {
          peer.update(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "tool-1", status: "completed" });
          peer.say(sessionId, "tool done");
          peer.reply(request, { stopReason: "end_turn" });
        }, toolMs);
        return;
      }
      if (text === "stream") {
        peer.say(sessionId, "first part");
        setTimeout(() => {
          peer.say(sessionId, ", second part");
          peer.reply(request, { stopReason: "end_turn" });
        }, chunkGapMs);
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
