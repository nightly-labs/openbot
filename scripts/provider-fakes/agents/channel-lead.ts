import { existsSync } from "node:fs";
import { join } from "node:path";
import { type AcpPeer, type AcpRequest, logEntry, serveFakeAcpAgent } from "../acp-agent";

const releaseDir = process.env.FAKE_RELEASE_DIR ?? "";
const models = { availableModels: [{ modelId: "fast", name: "Fast" }], currentModelId: "fast" };
const waiting = new Map<string, { request: AcpRequest; peer: AcpPeer; timer: NodeJS.Timeout }>();
let sessions = 0;

const markersOf = (text: string) => [...text.matchAll(/HOLD-([a-z0-9-]+)/gu)].map((match) => match[1] ?? "");
const released = (markers: readonly string[]) => markers.every((marker) => existsSync(join(releaseDir, marker)));

function finish(sessionId: string, stopReason: "end_turn" | "cancelled"): void {
  const turn = waiting.get(sessionId);
  if (!turn) return;
  waiting.delete(sessionId);
  clearInterval(turn.timer);
  logEntry({ event: "done", at: Date.now(), sessionId, stopReason });
  if (stopReason === "end_turn") turn.peer.say(sessionId, "Done.");
  turn.peer.reply(turn.request, { stopReason });
}

serveFakeAcpAgent(
  {
    initialize: (request, peer) =>
      peer.reply(request, {
        protocolVersion: 1,
        agentInfo: { name: "channel-lead", title: "Channel lead", version: "1.0.0" },
        agentCapabilities: { loadSession: true },
      }),
    "session/new": (request, peer) => {
      sessions += 1;
      peer.reply(request, { sessionId: `lead-${process.pid}-${sessions}`, models });
    },
    "session/load": (request, peer) => peer.reply(request, { models }),
    "session/resume": (request, peer) => peer.reply(request, { models }),
    "session/prompt": (request, peer) => {
      const sessionId = request.params.sessionId ?? "";
      const text = (request.params.prompt ?? [])
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("\n");
      const markers = markersOf(text);
      logEntry({ event: "prompt", at: Date.now(), sessionId, markers, text: text.slice(-400) });
      const timer = setInterval(() => {
        if (released(markers)) finish(sessionId, "end_turn");
      }, 20);
      waiting.set(sessionId, { request, peer, timer });
    },
  },
  {
    onNotification: (method, params) => {
      if (method === "session/cancel" && params.sessionId) finish(params.sessionId, "cancelled");
    },
  },
);
