// The ACP agent of `acp-turn-stall-e2e.ts`. Each prompt text names what the agent does:
// - `hang` never answers and ignores `session/cancel`, as an OpenCode prompt that stays open (#2858).
// - `tool` keeps one tool call open for `FAKE_TOOL_MS`, then answers.
// - `stream` sends its answer in two chunks `FAKE_CHUNK_GAP_MS` apart, then answers.
// - `hang-once` never answers until a `session/resume` of its session, as an Antigravity prompt that
//   its harness lost (#4846). It sends only an `available_commands_update`. After the resume it
//   answers at once.
// - `quiet` sends one line, stays silent for `FAKE_QUIET_MS`, then answers, as a background task.
// - `retry-once` is silent for `FAKE_RETRY_MS`, sends OpenCode's model retry notice, and answers
//   `FAKE_RETRY_MS` later, as OpenCode after a model that did not answer its first request (#9941).
// - `retry-forever` sends such a notice each `FAKE_RETRY_MS`, six times, after a null notice for the
//   failed attempt from the second on, and never answers.
// - `retry-rate-limit` sends a rate limit retry notice each `FAKE_RATE_RETRY_MS`, three times, then
//   answers after half that time.
// Each other prompt answers at once. `FAKE_NO_LOAD=1` offers no `session/load`, as some custom agents.
// `FAKE_RESUME=1` offers `session/resume`, as Antigravity.
import { type AcpParams, type AcpPeer, type AcpRequest, logEntry, serveFakeAcpAgent } from "../acp-agent";

const MODELS = [{ modelId: "fake-alpha", name: "Fake Alpha" }];
const toolMs = Number(process.env.FAKE_TOOL_MS ?? 0);
const chunkGapMs = Number(process.env.FAKE_CHUNK_GAP_MS ?? 0);
const quietMs = Number(process.env.FAKE_QUIET_MS ?? 0);
const retryMs = Number(process.env.FAKE_RETRY_MS ?? 0);
const rateRetryMs = Number(process.env.FAKE_RATE_RETRY_MS ?? 0);
const loadSession = process.env.FAKE_NO_LOAD !== "1";
const sessionCapabilities = process.env.FAKE_RESUME === "1" ? { sessionCapabilities: { resume: {} } } : {};
const resumed = new Set<string>();
let count = 0;

/** OpenCode 2.2.7's notice of a model retry, or of a failed retried attempt when `attempt` is null. */
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
        agentCapabilities: { loadSession, ...sessionCapabilities },
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
      if (text === "hang-once" && !resumed.has(sessionId)) {
        // An update about the session, not about the prompt: the prompt is still lost.
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
