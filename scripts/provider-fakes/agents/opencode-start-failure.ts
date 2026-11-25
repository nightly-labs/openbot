import { logEntry, serveFakeAcpAgent } from "../acp-agent";

const MODEL = "opencode/big-pickle";
const version = process.env.FAKE_OPENCODE_VERSION ?? "0.0.0";

if (process.argv.includes("--version")) {
  process.stdout.write(`${version}\n`);
  process.exit(0);
}
logEntry({ event: "start", version });

let count = 0;
serveFakeAcpAgent({
  initialize: (request, peer) =>
    process.env.FAKE_OPENCODE_FAIL === "1"
      ? peer.fail(request, { code: -32603, message: "Internal error: Internal service failure" })
      : peer.reply(request, { protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [] }),
  "session/new": (request, peer) => {
    count += 1;
    peer.reply(request, {
      sessionId: `s-${process.pid}-${count}`,
      models: { availableModels: [{ modelId: MODEL, name: "Big Pickle" }], currentModelId: MODEL },
    });
  },
});
