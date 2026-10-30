// The ACP agent of `acp-turn-stall-e2e.ts`. Each prompt text names what the agent does:
// - `hang` never answers and ignores `session/cancel`, as an OpenCode prompt that stays open (#2858).
// - `tool` keeps one tool call open for `FAKE_TOOL_MS`, then answers.
// - `stream` sends its answer in two chunks `FAKE_CHUNK_GAP_MS` apart, then answers.
// Each other prompt answers at once. `FAKE_NO_LOAD=1` offers no `session/load`, as some custom agents.
import { type AcpParams, type AcpPeer, type AcpRequest, logEntry, serveFakeAcpAgent } from "../acp-agent";

const MODELS = [{ modelId: "fake-alpha", name: "Fake Alpha" }];
const toolMs = Number(process.env.FAKE_TOOL_MS ?? 0);
const chunkGapMs = Number(process.env.FAKE_CHUNK_GAP_MS ?? 0);
const loadSession = process.env.FAKE_NO_LOAD !== "1";
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

function restore(request: AcpRequest, peer: AcpPeer): void {
  const sessionId = request.params.sessionId ?? "";
  logEntry({ event: request.method, sessionId });
  peer.reply(request, setup(sessionId));
}

/** The user's text, without the instructions that OpenBot puts first in a new or loaded session. */
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
        agentCapabilities: { loadSession },
        authMethods: [],
      }),
    "session/new": (request, peer) => {
      count += 1;
      logEntry({ event: "session/new" });
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
