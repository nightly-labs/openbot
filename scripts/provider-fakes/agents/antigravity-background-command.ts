import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { type AcpRequest, logEntry, serveFakeAcpAgent } from "../acp-agent";

const MODELS = { availableModels: [{ modelId: "gemini-fake", name: "Gemini Fake" }], currentModelId: "gemini-fake" };
const COMMAND = "tool-linger";
const sessions = new Map<string, { cwd: string; updatedAt: number; commandAt: number | null; finished: boolean }>();
let opened = 0;
let replies = 0;

function promptText(request: AcpRequest): string {
  return (request.params.prompt ?? [])
    .map((block) => block.text ?? "")
    .join("")
    .replace(/^[\s\S]*<\/openbot-developer-instructions>/u, "")
    .trim();
}

function finishedCommand(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  const finish = join(process.env.FAKE_FINISH_DIR ?? "", sessionId);
  if (session.commandAt !== null && existsSync(finish) && statSync(finish).mtimeMs >= session.commandAt) {
    session.commandAt = null;
    session.finished = true;
    session.updatedAt += 1_000;
    logEntry({ event: "command-finished", sessionId });
  }
  return session.finished;
}

serveFakeAcpAgent({
  initialize: (request, peer) =>
    peer.reply(request, {
      protocolVersion: 1,
      agentInfo: { name: "Antigravity ACP Server", version: process.env.FAKE_VERSION ?? "1.5.14" },
      agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {}, list: {} } },
      authMethods: [],
    }),
  "session/new": (request, peer) => {
    opened += 1;
    const sessionId = `agy-${process.pid}-${opened}`;
    sessions.set(sessionId, { cwd: request.params.cwd ?? "", updatedAt: Date.now(), commandAt: null, finished: false });
    peer.reply(request, { sessionId, models: MODELS });
  },
  "session/resume": (request, peer) => {
    const sessionId = request.params.sessionId ?? "";
    if (!sessions.has(sessionId))
      sessions.set(sessionId, {
        cwd: request.params.cwd ?? "",
        updatedAt: Date.now(),
        commandAt: null,
        finished: false,
      });
    peer.reply(request, { models: MODELS });
  },
  "session/list": (request, peer) => {
    const listed = [...sessions.entries()]
      .filter(([sessionId, session]) => {
        finishedCommand(sessionId);
        return session.cwd === request.params.cwd;
      })
      .map(([sessionId, session]) => ({
        sessionId,
        cwd: session.cwd,
        updatedAt: new Date(session.updatedAt).toISOString(),
      }));
    logEntry({ event: "list" });
    peer.reply(request, { sessions: listed });
  },
  "session/prompt": (request, peer) => {
    const sessionId = request.params.sessionId ?? "";
    const text = promptText(request);
    logEntry({ event: "prompt", sessionId, text });
    const session = sessions.get(sessionId);
    if (text.endsWith("linger") && session) {
      session.commandAt = Date.now();
      session.finished = false;
      peer.update(sessionId, {
        sessionUpdate: "tool_call",
        toolCallId: COMMAND,
        title: "ffprobe -",
        kind: "execute",
        status: "in_progress",
        rawInput: { CommandLine: "ffprobe -" },
      });
      peer.say(sessionId, "The report is ready.");
    } else if (text.includes("<openbot_background_wake>") && finishedCommand(sessionId)) {
      peer.update(sessionId, { sessionUpdate: "tool_call_update", toolCallId: COMMAND, status: "completed" });
      peer.say(sessionId, "The command finished.");
    } else if (text.endsWith("status") && session?.commandAt) {
      session.commandAt = null;
      session.finished = true;
      peer.update(sessionId, { sessionUpdate: "tool_call_update", toolCallId: COMMAND, status: "completed" });
      peer.say(sessionId, "The command already finished.");
    } else peer.say(sessionId, "ok");
    replies += 1;
    peer.reply(request, {
      stopReason: "end_turn",
      usage: { inputTokens: replies, outputTokens: 1, totalTokens: replies + 1 },
    });
  },
});
