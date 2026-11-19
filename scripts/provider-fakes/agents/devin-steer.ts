import { randomUUID } from "node:crypto";
import { type AcpPeer, type AcpRequest, logEntry, serveFakeAcpAgent } from "../acp-agent";

const MODELS = {
  availableModels: [{ modelId: "swe-fake", name: "SWE Fake" }],
  currentModelId: "swe-fake",
};
const open = new Map<string, AcpRequest[]>();
let sessions = 0;
let runs = 0;
let lastPeer: AcpPeer | undefined;

function promptText(request: AcpRequest): string {
  return (request.params.prompt ?? [])
    .map((block) => block.text ?? "")
    .join("")
    .replace(/^[\s\S]*<\/openbot-developer-instructions>/u, "")
    .trim();
}

function endRun(peer: AcpPeer, prompts: readonly AcpRequest[]): void {
  runs += 1;
  const result = {
    stopReason: "end_turn",
    usage: { inputTokens: runs * 100, outputTokens: runs, totalTokens: runs * 101 },
    _meta: { "cognition.ai/userMessageId": randomUUID() },
  };
  for (const prompt of prompts) peer.reply(prompt, result);
}

serveFakeAcpAgent(
  {
    initialize: (request, peer) =>
      peer.reply(request, {
        protocolVersion: 1,
        agentInfo: { name: "affogato", title: "Devin Agent", version: "0.0.0-dev" },
        agentCapabilities: {
          loadSession: true,
          sessionCapabilities: { list: {}, close: {} },
          _meta: process.env.FAKE_MID_TURN === "0" ? {} : { "cognition.ai/midTurnPrompts": true },
        },
        authMethods: [{ id: "devin-browser", name: "Log in with browser" }],
      }),
    "session/new": (request, peer) => {
      sessions += 1;
      peer.reply(request, { sessionId: `devin-${process.pid}-${sessions}`, models: MODELS });
    },
    "session/load": (request, peer) => peer.reply(request, { models: MODELS }),
    "session/prompt": (request, peer) => {
      const sessionId = request.params.sessionId ?? "";
      const text = promptText(request);
      const running = open.get(sessionId);
      lastPeer = peer;
      logEntry({ event: "prompt", sessionId, text, steer: running !== undefined });
      if (running) {
        peer.update(sessionId, {
          sessionUpdate: "tool_call_update",
          toolCallId: "tool-1",
          status: "in_progress",
          _meta: { "cognition.ai/background": true },
        });
        if (text.startsWith("more")) {
          running.push(request);
          return;
        }
        open.delete(sessionId);
        if (text.startsWith("separate")) {
          endRun(peer, running);
          peer.say(sessionId, `separate: ${text}`);
          endRun(peer, [request]);
          return;
        }
        peer.say(sessionId, `steered: ${text}`);
        endRun(peer, [...running, request]);
        return;
      }
      if (text === "ask") {
        open.set(sessionId, [request]);
        void peer
          .ask("session/request_permission", {
            sessionId,
            toolCall: { toolCallId: "tool-2", title: "rm -rf build", kind: "execute", status: "pending" },
            options: [
              { optionId: "allow_once", name: "Allow", kind: "allow_once" },
              { optionId: "reject_once", name: "Reject", kind: "reject_once" },
            ],
          })
          .then((reply) => {
            if (open.get(sessionId)?.[0] !== request) return;
            open.delete(sessionId);
            const outcome = JSON.stringify(reply);
            logEntry({ event: "permission", sessionId, text: outcome });
            peer.say(sessionId, `asked: ${outcome}`);
            endRun(peer, [request]);
          });
        return;
      }
      if (text !== "work") {
        peer.say(sessionId, "ok");
        endRun(peer, [request]);
        return;
      }
      open.set(sessionId, [request]);
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
      const prompts = open.get(sessionId) ?? [];
      open.delete(sessionId);
      for (const prompt of prompts) lastPeer?.reply(prompt, { stopReason: "cancelled" });
    },
  },
);
