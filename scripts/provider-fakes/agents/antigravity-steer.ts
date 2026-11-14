// The Antigravity agent of `antigravity-steer-e2e.ts`. It steers as `agy acp` 1.5.8 did in a live
// probe: a prompt that arrives while another prompt of the session is open answers the open one with
// `end_turn` at once, echoes the new message as `user_message_chunk`, and the work goes on under the
// new prompt. A `work` prompt opens one tool call and stays open. A steer that starts with `more`
// also stays open; another steer ends the tool call and answers with its text. Each other prompt
// answers at once. An `ask` prompt asks for a permission and answers with the outcome.
// `FAKE_VERSION` sets the version in `agentInfo`.
import { type AcpPeer, type AcpRequest, logEntry, serveFakeAcpAgent } from "../acp-agent";

const MODELS = { availableModels: [{ modelId: "gemini-fake", name: "Gemini Fake" }], currentModelId: "gemini-fake" };
/** The prompt that is open, by session. */
const open = new Map<string, AcpRequest>();
let sessions = 0;
let replies = 0;
/** The peer of the last request, for `session/cancel`, which is a notification. */
let lastPeer: AcpPeer | undefined;

function promptText(request: AcpRequest): string {
  return (request.params.prompt ?? [])
    .map((block) => block.text ?? "")
    .join("")
    .replace(/^[\s\S]*<\/openbot-developer-instructions>/u, "")
    .trim();
}

function answer(peer: AcpPeer, request: AcpRequest): void {
  replies += 1;
  peer.reply(request, {
    stopReason: "end_turn",
    usage: { inputTokens: replies, outputTokens: 1, totalTokens: replies + 1 },
  });
}

serveFakeAcpAgent(
  {
    initialize: (request, peer) =>
      peer.reply(request, {
        protocolVersion: 1,
        agentInfo: { name: "Antigravity ACP Server", version: process.env.FAKE_VERSION ?? "1.5.8" },
        agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } },
        authMethods: [],
      }),
    "session/new": (request, peer) => {
      sessions += 1;
      peer.reply(request, { sessionId: `agy-${process.pid}-${sessions}`, models: MODELS });
    },
    "session/resume": (request, peer) => peer.reply(request, { models: MODELS }),
    "session/prompt": (request, peer) => {
      const sessionId = request.params.sessionId ?? "";
      const text = promptText(request);
      const previous = open.get(sessionId);
      lastPeer = peer;
      logEntry({ event: "prompt", sessionId, text, steer: previous !== undefined });
      if (previous) {
        open.delete(sessionId);
        answer(peer, previous);
        peer.update(sessionId, { sessionUpdate: "user_message_chunk", content: { type: "text", text } });
        if (text.startsWith("more")) {
          open.set(sessionId, request);
          return;
        }
        peer.update(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "tool-1", status: "completed" });
        peer.say(sessionId, `steered: ${text}`);
        answer(peer, request);
        return;
      }
      if (text === "ask") {
        open.set(sessionId, request);
        void peer
          .ask("session/request_permission", {
            sessionId,
            toolCall: { toolCallId: "tool-2", title: "rm -rf build", kind: "execute", status: "pending" },
            options: [
              { optionId: "allow", name: "Allow", kind: "allow_once" },
              { optionId: "reject", name: "Reject", kind: "reject_once" },
            ],
          })
          .then((reply) => {
            if (open.get(sessionId) !== request) return;
            open.delete(sessionId);
            const outcome = JSON.stringify(reply);
            logEntry({ event: "permission", sessionId, text: outcome });
            peer.say(sessionId, `asked: ${outcome}`);
            answer(peer, request);
          });
        return;
      }
      if (text !== "work") {
        peer.say(sessionId, "ok");
        answer(peer, request);
        return;
      }
      open.set(sessionId, request);
      peer.update(sessionId, {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "sleep 25",
        kind: "execute",
        status: "in_progress",
      });
    },
  },
  {
    onNotification: (method, params) => {
      if (method !== "session/cancel") return;
      const sessionId = params.sessionId ?? "";
      logEntry({ event: "cancel", sessionId });
      const prompt = open.get(sessionId);
      open.delete(sessionId);
      if (prompt) lastPeer?.reply(prompt, { stopReason: "cancelled" });
    },
  },
);
