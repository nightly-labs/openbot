// A fake `kiro-cli` for `kiro-parallel-e2e.ts`. It answers `--version` as Kiro CLI 2.37.1 does, and as an ACP agent it
// holds each prompt for `FAKE_PROMPT_MS` and logs when the prompt of each session starts and ends, so the test can
// tell whether the turns of one process overlapped. A prompt that has "fail" in its text ends with an error.
import { logEntry, serveFakeAcpAgent } from "../acp-agent";

if (process.argv.includes("--version")) {
  process.stdout.write("kiro-cli 2.37.1\n");
  process.exit(0);
}

const PROMPT_MS = Number(process.env.FAKE_PROMPT_MS ?? 1500);
const MODELS = [{ modelId: "fake-model", name: "Fake model", description: "A fake model with 1M context window" }];
let sessions = 0;
let active = 0;

serveFakeAcpAgent({
  initialize: (request, peer) => {
    logEntry({ event: "initialize", argv: process.argv.slice(2) });
    peer.reply(request, {
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, promptCapabilities: { image: true } },
      authMethods: [],
      agentInfo: { name: "Kiro CLI Agent", version: "2.37.1" },
    });
  },
  "session/new": (request, peer) => {
    sessions += 1;
    const sessionId = `kiro-session-${process.pid}-${sessions}`;
    logEntry({ event: "session/new", sessionId, cwd: request.params.cwd });
    peer.reply(request, { sessionId, models: { availableModels: MODELS, currentModelId: "fake-model" } });
  },
  "session/prompt": (request, peer) => {
    const sessionId = request.params.sessionId ?? "";
    const text = request.params.prompt?.map((part) => part.text ?? "").join("") ?? "";
    // The instructions come first and quote some words, so only what follows them is the message.
    const message = text.split("</openbot-developer-instructions>").at(-1) ?? "";
    active += 1;
    logEntry({ event: "prompt-start", sessionId, at: Date.now(), active, message: message.trim().slice(0, 40) });
    setTimeout(() => {
      active -= 1;
      logEntry({ event: "prompt-end", sessionId, at: Date.now(), active });
      peer.say(sessionId, "Done.");
      peer.reply(request, { stopReason: "end_turn" });
    }, PROMPT_MS);
  },
});
