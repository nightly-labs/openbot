// The custom ACP agent of `custom-agent-steer-e2e.ts` (#4977). It has the `_session/steering` request
// of OpenCode 2.3.0 (#8231): `initialize` reports `_meta.steering.supported`, and `_session/steering`
// takes the blocks of a `session/prompt`. While the session runs a turn it answers
// `{ outcome: "injected" }`, and the open prompt then ends with the steer's text. With no turn it
// answers `{ outcome: "promptRequired", reason: "noRunningTurn" }`. A `work` prompt opens one tool call
// and stays open until a steer arrives. Each other prompt answers at once. `FAKE_NO_STEERING=1` is a
// custom agent without the request: no `_meta`, and the method is not found. `FAKE_NEVER_RUNNING=1`
// answers `promptRequired` also while the prompt is open; the prompt then ends by itself.
import { type AcpPeer, type AcpRequest, logEntry, serveFakeAcpAgent } from "../acp-agent";

const MODELS = {
  availableModels: [{ modelId: "quick", name: "Quick" }],
  currentModelId: "quick",
};
const steers = process.env.FAKE_NO_STEERING !== "1";
const neverRunning = process.env.FAKE_NEVER_RUNNING === "1";
/** The `work` prompt that waits for a steer, by session. */
const open = new Map<string, AcpRequest>();
let count = 0;

function text(blocks: AcpRequest["params"]["prompt"]): string {
  return (blocks ?? [])
    .map((block) => block.text ?? "")
    .join("")
    .replace(/^[\s\S]*<\/openbot-developer-instructions>/u, "")
    .trim();
}

function finish(peer: AcpPeer, sessionId: string, reply: string): void {
  const prompt = open.get(sessionId);
  if (!prompt) return;
  open.delete(sessionId);
  peer.update(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "tool-1", status: "completed" });
  peer.say(sessionId, reply);
  peer.reply(prompt, { stopReason: "end_turn" });
}

serveFakeAcpAgent(
  {
    initialize: (request, peer) =>
      peer.reply(request, {
        protocolVersion: 1,
        agentInfo: { name: "fake-steering-agent", version: "1.0.0" },
        agentCapabilities: { loadSession: true, promptCapabilities: { image: true } },
        authMethods: [],
        ...(steers ? { _meta: { steering: { supported: true } } } : {}),
      }),
    "session/new": (request, peer) => {
      count += 1;
      peer.reply(request, { sessionId: `ses-${process.pid}-${count}`, models: MODELS });
    },
    "session/prompt": (request, peer) => {
      const sessionId = request.params.sessionId ?? "";
      const prompt = text(request.params.prompt);
      logEntry({ event: "prompt", sessionId, text: prompt });
      if (prompt !== "work") {
        peer.say(sessionId, "ok");
        peer.reply(request, { stopReason: "end_turn" });
        return;
      }
      open.set(sessionId, request);
      peer.update(sessionId, {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "Long build",
        kind: "execute",
        status: "in_progress",
      });
    },
    "_session/steering": (request, peer) => {
      const sessionId = request.params.sessionId ?? "";
      const blocks = request.params.prompt ?? [];
      logEntry({
        event: "steering",
        sessionId,
        text: text(blocks),
        content: blocks.map((block) => block.type),
      });
      if (!steers) {
        peer.fail(request, { code: -32601, message: "Method not found" });
        return;
      }
      if (neverRunning || !open.has(sessionId)) {
        peer.reply(request, { outcome: "promptRequired", reason: "noRunningTurn" });
        finish(peer, sessionId, "done without steering");
        return;
      }
      peer.reply(request, { outcome: "injected" });
      finish(peer, sessionId, `steered: ${text(blocks)}`);
    },
  },
  {
    onNotification: (method, params) => {
      if (method !== "session/cancel") return;
      logEntry({ event: "cancel", sessionId: params.sessionId ?? "" });
    },
  },
);
