import { logEntry, serveFakeAcpAgent } from "../acp-agent";

const MODEL = "opencode/big-pickle";
const version = process.env.FAKE_OPENCODE_VERSION ?? "2.3.2";
const activationFailures = Number(process.env.FAKE_OPENCODE_ACTIVATION_FAILURES ?? "0");
const activationDelayMs = Number(process.env.FAKE_OPENCODE_ACTIVATION_DELAY_MS ?? "0");

if (process.argv.includes("--version")) {
  process.stdout.write(`${version}\n`);
  process.exit(0);
}
logEntry({ event: "start", version });

let failed = 0;
let opened = 0;
serveFakeAcpAgent({
  initialize: (request, peer) =>
    peer.reply(request, { protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [] }),
  "session/new": (request, peer) => {
    if (activationFailures < 0 || failed < activationFailures) {
      failed += 1;
      logEntry({ event: "plugins-activating", failed });
      setTimeout(
        () =>
          peer.fail(request, {
            code: -32603,
            message: "Internal error: Internal service failure",
            data: { errorName: "ServiceUnavailableError" },
          }),
        activationDelayMs,
      );
      return;
    }
    opened += 1;
    peer.reply(request, {
      sessionId: `s-${process.pid}-${opened}`,
      models: { availableModels: [{ modelId: MODEL, name: "Big Pickle" }], currentModelId: MODEL },
    });
  },
});
