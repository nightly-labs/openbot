// The `opencode` of `opencode-installed-fallback-e2e.ts`. It prints `FAKE_OPENCODE_VERSION` for
// `--version`. With `FAKE_OPENCODE_FAIL=1` it fails `initialize` as OpenCode 2.3.0 did on Windows
// (#10174): `-32603` "Internal error: Internal service failure". Each start writes a log line.
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
