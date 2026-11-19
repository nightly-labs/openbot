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
