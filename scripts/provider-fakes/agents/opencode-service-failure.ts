// The `opencode acp` of `opencode-service-failure-e2e.ts`. OpenCode 2.1.3 answers each request whose
// failure has no ACP error of its own with `-32603` "Internal error: Internal service failure" and
// the JavaScript error class in `data.errorName` (#2850). This fake fails each prompt in that way.
import { serveFakeAcpAgent } from "../acp-agent";

const MODEL = "opencode/big-pickle";

let count = 0;
serveFakeAcpAgent({
  initialize: (request, peer) =>
    peer.reply(request, { protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [] }),
  "session/new": (request, peer) => {
    count += 1;
    peer.reply(request, {
      sessionId: `s-${process.pid}-${count}`,
      models: { availableModels: [{ modelId: MODEL, name: "Big Pickle" }], currentModelId: MODEL },
    });
  },
  "session/prompt": (request, peer) =>
    peer.fail(request, {
      code: -32603,
      message: "Internal error: Internal service failure",
      data: { errorName: "UnknownError" },
    }),
});
