import type { ToolKind } from "@agentclientprotocol/sdk";
import { logEntry, serveFakeAcpAgent } from "../acp-agent";

const MODELS = { availableModels: [{ modelId: "gemini-fake", name: "Gemini Fake" }], currentModelId: "gemini-fake" };
const toolCalls: {
  toolCallId: string;
  title: string;
  kind: ToolKind;
  rawInput?: unknown;
  locations?: { path: string }[];
  idOnlyPermission?: true;
  untitledPermission?: true;
}[] = JSON.parse(process.env.FAKE_TOOL_CALLS ?? "[]");
let sessions = 0;

function selectedOption(reply: unknown): string {
  if (typeof reply !== "object" || reply === null || !("outcome" in reply)) return "none";
  const outcome = reply.outcome;
  if (typeof outcome !== "object" || outcome === null) return "none";
  return "optionId" in outcome && typeof outcome.optionId === "string" ? outcome.optionId : "cancelled";
}

serveFakeAcpAgent({
  initialize: (request, peer) =>
    peer.reply(request, {
      protocolVersion: 1,
      agentInfo: { name: "Antigravity ACP Server", version: "1.5.10" },
      agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } },
      authMethods: [],
    }),
  "session/new": (request, peer) => {
    sessions += 1;
    peer.reply(request, { sessionId: `agy-${process.pid}-${sessions}`, models: MODELS });
  },
  "session/resume": (request, peer) => peer.reply(request, { models: MODELS }),
  "session/prompt": async (request, peer) => {
    const sessionId = request.params.sessionId ?? "";
    for (const { idOnlyPermission, untitledPermission, ...toolCall } of toolCalls) {
      peer.update(sessionId, { sessionUpdate: "tool_call", status: "pending", ...toolCall });
      const reply = await peer.ask("session/request_permission", {
        sessionId,
        toolCall: untitledPermission
          ? { toolCallId: toolCall.toolCallId }
          : idOnlyPermission
            ? { toolCallId: toolCall.toolCallId, title: toolCall.title }
            : { ...toolCall, status: "pending" },
        options: [
          { optionId: "allow", name: "Allow", kind: "allow_once" },
          { optionId: "reject", name: "Reject", kind: "reject_once" },
        ],
      });
      logEntry({ event: "permission", sessionId, text: toolCall.toolCallId, outcome: selectedOption(reply) });
      peer.update(sessionId, {
        sessionUpdate: "tool_call_update",
        toolCallId: toolCall.toolCallId,
        status: "completed",
      });
    }
    peer.say(sessionId, "done");
    peer.reply(request, { stopReason: "end_turn" });
  },
});
