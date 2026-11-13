// The `cursor-agent` of `cursor-key-accounts-e2e.ts`. It acts as Cursor 2026.10.01-e373342 does with
// `AGENT_CLI_CREDENTIAL_STORE=memory`: the process does not read the sign-in of the computer user, so
// a session opens only with an accepted `CURSOR_API_KEY`. With an empty key the session answers
// "Authentication required" (-32000), and with a refused key an internal error (-32603), as the real
// CLI does. With the default store, the process is signed in as the computer user. Each start is
// logged to `FAKE_LOG`, with the kind of key and never the key itself.
import { type LogValue, logEntry, serveFakeAcpAgent } from "../acp-agent";

const key = process.env.CURSOR_API_KEY;
const memory = process.env.AGENT_CLI_CREDENTIAL_STORE === "memory";
const keyKind =
  key === undefined ? "absent" : key === "" ? "empty" : key === process.env.FAKE_GOOD_KEY ? "good" : "other";
const start: Record<string, LogValue> = {
  argv: process.argv.slice(2),
  store: process.env.AGENT_CLI_CREDENTIAL_STORE ?? null,
  key: keyKind,
  authToken: process.env.CURSOR_AUTH_TOKEN === undefined ? "absent" : process.env.CURSOR_AUTH_TOKEN ? "set" : "empty",
};
logEntry(start);

if (process.argv.includes("--version")) {
  process.stdout.write(`${process.env.FAKE_VERSION ?? "2026.10.01-e373342"}\n`);
  process.exit(0);
}

const MODEL = memory ? "key-plan-model" : "own-plan-model";
let count = 0;

serveFakeAcpAgent({
  initialize: (request, peer) =>
    peer.reply(request, {
      protocolVersion: 1,
      agentCapabilities: { loadSession: true },
      authMethods: [{ id: "cursor_login", name: "Cursor login" }],
    }),
  "session/new": (request, peer) => {
    if (memory && keyKind !== "good") {
      peer.fail(
        request,
        keyKind === "other"
          ? { code: -32603, message: "Internal error", data: { message: "Failed to initialize session services" } }
          : { code: -32000, message: "Authentication required" },
      );
      return;
    }
    count += 1;
    peer.reply(request, {
      sessionId: `s-${process.pid}-${count}`,
      configOptions: [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: MODEL,
          options: [{ value: MODEL, name: MODEL }],
        },
      ],
      models: { availableModels: [{ modelId: MODEL, name: MODEL }], currentModelId: MODEL },
    });
  },
});
