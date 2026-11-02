// The custom agent of `custom-acp-agent-e2e.ts`. `FAKE_TITLE` names it in each answer, `FAKE_MODELS`
// gives it two models, `FAKE_TOKEN` stands for a secret in its env, `FAKE_CRASH` makes it stop at
// its first input with the secret on stderr, and `FAKE_SIGN_IN` makes it refuse `session/new` as an
// agent that needs sign-in does.
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
              ],
              currentModelId: "fast",
            },
          }
        : {};
      peer.reply(request, { sessionId: `s-${sessions}`, ...models });
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
      log({ event: "request", method: request.method, sessionId: request.params.sessionId ?? null }),
  },
);
