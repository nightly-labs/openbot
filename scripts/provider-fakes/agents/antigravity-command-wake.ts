import { type AcpPeer, type AcpRequest, logEntry, serveFakeAcpAgent } from "../acp-agent";

const MODELS = { availableModels: [{ modelId: "gemini-fake", name: "Gemini Fake" }], currentModelId: "gemini-fake" };
const ANSWER = "The build finished: 42 files.";
const TEST_ANSWER = "The tests passed: 7 of 7.";
const COMMAND = "tool-build";
const TEST_COMMAND = "tool-test";
const silentWake = process.env.FAKE_SILENT_WAKE === "1";
const chain = process.env.FAKE_CHAIN === "1";
const wakeAfterMs = Number(process.env.FAKE_WAKE_MS ?? 3000);
let sessions = 0;
let updatedAt = Date.now();

function promptText(request: AcpRequest): string {
  return (request.params.prompt ?? []).map((block) => block.text ?? "").join("");
}

function reportCommandAndAnswer(peer: AcpPeer, sessionId: string, command = COMMAND, answer = ANSWER): void {
  peer.update(sessionId, {
    sessionUpdate: "tool_call_update",
    toolCallId: command,
    status: "completed",
    rawOutput: { output: "Command exited with code 0.", exit_code: 0 },
  });
  peer.say(sessionId, answer);
  peer.update(sessionId, { sessionUpdate: "usage_update", used: 100, size: 1000 });
}

function startTests(peer: AcpPeer, sessionId: string): void {
  peer.update(sessionId, {
    sessionUpdate: "tool_call",
    toolCallId: TEST_COMMAND,
    title: "npm test",
    kind: "execute",
    status: "in_progress",
    rawInput: { CommandLine: "npm test" },
  });
  peer.update(sessionId, { sessionUpdate: "usage_update", used: 120, size: 1000 });
  setTimeout(() => {
    updatedAt = Date.now() + 2000;
    reportCommandAndAnswer(peer, sessionId, TEST_COMMAND, TEST_ANSWER);
  }, wakeAfterMs);
}

serveFakeAcpAgent({
  initialize: (request, peer) =>
    peer.reply(request, {
      protocolVersion: 1,
      agentInfo: { name: "Antigravity ACP Server", version: process.env.FAKE_VERSION ?? "1.5.16" },
      agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {}, list: {} } },
      authMethods: [],
    }),
  "session/new": (request, peer) => {
    sessions += 1;
    peer.reply(request, { sessionId: `agy-${process.pid}-${sessions}`, models: MODELS });
  },
  "session/resume": (request, peer) => peer.reply(request, { models: MODELS }),
  "session/list": (request, peer) =>
    peer.reply(request, {
      sessions: [...Array(sessions).keys()].map((index) => ({
        sessionId: `agy-${process.pid}-${index + 1}`,
        cwd: request.params.cwd,
        title: "Session",
        updatedAt: new Date(updatedAt).toISOString(),
      })),
    }),
  "session/prompt": (request, peer) => {
    const sessionId = request.params.sessionId ?? "";
    const text = promptText(request);
    const wake = text.includes("<openbot_background_wake>");
    logEntry({ event: "prompt", sessionId, wake });
    if (wake) {
      if (silentWake) reportCommandAndAnswer(peer, sessionId);
      else peer.say(sessionId, ANSWER);
      peer.reply(request, { stopReason: "end_turn" });
      return;
    }
    peer.update(sessionId, {
      sessionUpdate: "tool_call",
      toolCallId: COMMAND,
      title: "npm run build",
      kind: "execute",
      status: "in_progress",
      rawInput: { CommandLine: "npm run build" },
    });
    peer.reply(request, { stopReason: "end_turn" });
    setTimeout(() => {
      updatedAt = Date.now() + 1000;
      if (silentWake) return;
      reportCommandAndAnswer(peer, sessionId);
      if (chain) startTests(peer, sessionId);
    }, wakeAfterMs);
  },
});
