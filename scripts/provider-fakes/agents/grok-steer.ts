// The Grok agent of `grok-steer-e2e.ts`. A `work` prompt opens one tool call and stays open until
// `_x.ai/interject` arrives. The agent then answers with the interjection's text and ends the turn,
// as Grok reads an interjection at its next safe point (`xai-grok-shell/src/extensions/interject.rs`).
// `FAKE_NO_INTERJECT=1` refuses the method as a Grok without it does, and ends the open turn.
// Each other prompt answers at once.
import { type AcpPeer, type AcpRequest, logEntry, serveFakeAcpAgent } from "../acp-agent";

const MODELS = [{ modelId: "grok-fake", name: "Grok Fake" }];
const interjects = process.env.FAKE_NO_INTERJECT !== "1";
/** The `work` prompt that waits for an interjection, by session. */
const open = new Map<string, AcpRequest>();
let count = 0;

function setup(sessionId: string) {
  return { sessionId, models: { availableModels: MODELS, currentModelId: "grok-fake" } };
}

function finish(peer: AcpPeer, sessionId: string, text: string): void {
  const prompt = open.get(sessionId);
  if (!prompt) return;
  open.delete(sessionId);
  peer.update(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "tool-1", status: "completed" });
  peer.say(sessionId, text);
  peer.reply(prompt, { stopReason: "end_turn" });
}

serveFakeAcpAgent(
  {
    initialize: (request, peer) =>
      peer.reply(request, {
        protocolVersion: 1,
        agentInfo: { name: "grok", version: "1.0.70" },
        agentCapabilities: { loadSession: true },
        authMethods: [],
      }),
    "session/new": (request, peer) => {
      count += 1;
      peer.reply(request, setup(`grok-${process.pid}-${count}`));
    },
    "session/prompt": (request, peer) => {
      const sessionId = request.params.sessionId ?? "";
      const text = (request.params.prompt ?? [])
        .map((block) => block.text ?? "")
        .join("")
        .replace(/^[\s\S]*<\/openbot-developer-instructions>/u, "")
        .trim();
      logEntry({ event: "prompt", sessionId, text });
      if (text !== "work") {
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
    "_x.ai/interject": (request, peer) => {
      const params = request.params;
      const sessionId = params.sessionId ?? "";
      logEntry({
        event: "interject",
        sessionId,
        text: params.text,
        interjectionId: params.interjectionId,
        content: (params.content ?? []).map((block) =>
          block.type === "image" ? `image:${block.mimeType}` : block.type,
        ),
        contentText: params.content?.[0]?.text,
      });
      if (!interjects) {
        peer.fail(request, { code: -32601, message: "Method not found" });
        finish(peer, sessionId, "done without steering");
        return;
      }
      // The reply of the real Grok 1.0.70.
      peer.reply(request, { result: { status: "queued" } });
      finish(peer, sessionId, `steered: ${params.text ?? ""}`);
    },
  },
  {
    onNotification: (method, params) => {
      if (method === "session/cancel") logEntry({ event: "cancel", sessionId: params.sessionId ?? "" });
    },
  },
);
