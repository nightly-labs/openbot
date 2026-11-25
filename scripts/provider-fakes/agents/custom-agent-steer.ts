import { type AcpPeer, type AcpRequest, logEntry, serveFakeAcpAgent } from "../acp-agent";

const MODELS = {
  availableModels: [{ modelId: "quick", name: "Quick" }],
  currentModelId: "quick",
};
const steers = process.env.FAKE_NO_STEERING !== "1";
const neverRunning = process.env.FAKE_NEVER_RUNNING === "1";
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
