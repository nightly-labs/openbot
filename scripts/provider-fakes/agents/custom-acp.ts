import { type LogValue, logEntry, serveFakeAcpAgent } from "../acp-agent";

const title = process.env.FAKE_TITLE;
const log = (entry: Readonly<Record<string, LogValue>>) =>
  logEntry({ pid: process.pid, token: process.env.FAKE_TOKEN ?? null, ...entry });
log({ event: "start", argv: process.argv.slice(2) });

if (process.env.FAKE_CRASH) {
  process.stdin.once("data", () => {
    process.stderr.write(`fatal: token ${process.env.FAKE_TOKEN} refused\n`);
    process.exit(3);
  });
}

let sessions = 0;
serveFakeAcpAgent(
  {
    initialize: (request, peer) =>
      peer.reply(request, {
        protocolVersion: 1,
        agentInfo: { name: "fake", title, version: "1.2.3" },
        agentCapabilities: { loadSession: true },
      }),
    "session/new": (request, peer) => {
      if (process.env.FAKE_SIGN_IN) return peer.fail(request, { code: -32000, message: "Authentication required" });
      sessions += 1;
      const models = process.env.FAKE_MODELS
        ? {
            models: {
              availableModels: [
                { modelId: "fast", name: "Fast" },
                { modelId: "deep", name: "Deep" },
                { modelId: '["deep","v2"]', name: "Deep v2" },
              ],
              currentModelId: "fast",
            },
          }
        : {};
      const response = { sessionId: `s-${sessions}`, ...models };
      setTimeout(() => peer.reply(request, response), Number(process.env.FAKE_SESSION_DELAY_MS ?? 0));
    },
    "session/prompt": (request, peer) => {
      const text = (request.params.prompt ?? [])
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join(" ");
      peer.say(request.params.sessionId, `${title} heard: ${text.slice(-40)}`);
      peer.reply(request, { stopReason: "end_turn" });
    },
  },
  {
    onRequest: (request) =>
      log({
        event: "request",
        method: request.method,
        sessionId: request.params.sessionId ?? null,
        modelId: request.params.modelId ?? null,
      }),
  },
);
