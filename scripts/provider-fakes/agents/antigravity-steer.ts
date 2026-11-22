import { type AcpPeer, type AcpRequest, logEntry, serveFakeAcpAgent } from "../acp-agent";

const MODELS = { availableModels: [{ modelId: "gemini-fake", name: "Gemini Fake" }], currentModelId: "gemini-fake" };
const open = new Map<string, AcpRequest>();
const waiting = new Set<string>();
let sessions = 0;
let replies = 0;
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
      if (waiting.has(sessionId)) {
        logEntry({ event: "refused", sessionId, text });
        peer.fail(request, {
          code: -32603,
          message: `Can't add this prompt to session ${sessionId}: the running prompt is waiting for a permission or question answer; answer it or send session/cancel, then send this prompt again`,
        });
        return;
      }
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
      if (text === "hold") {
        open.set(sessionId, request);
        waiting.add(sessionId);
        const toolCall = {
          toolCallId: "tool-hold",
          title: "touch b.txt",
          kind: "execute" as const,
          status: "pending" as const,
        };
        peer.update(sessionId, { sessionUpdate: "tool_call", ...toolCall });
        setTimeout(
          () => {
            void peer
              .ask("session/request_permission", {
                sessionId,
                toolCall,
                options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
              })
              .then(() => {
                waiting.delete(sessionId);
                if (open.get(sessionId) !== request) return;
                open.delete(sessionId);
                peer.update(sessionId, {
                  sessionUpdate: "tool_call_update",
                  toolCallId: "tool-hold",
                  status: "completed",
                });
                peer.say(sessionId, "held: done");
                answer(peer, request);
              });
          },
          Number(process.env.FAKE_HOLD_MS ?? 2000),
        );
        return;
      }
      if (text === "daemon") {
        peer.update(sessionId, {
          sessionUpdate: "tool_call",
          toolCallId: "tool-daemon",
          title: "npm run dev",
          kind: "execute",
          status: "in_progress",
          rawInput: { CommandLine: "npm run dev", IsDaemon: true },
        });
        peer.say(sessionId, "The dev server runs.");
        answer(peer, request);
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
