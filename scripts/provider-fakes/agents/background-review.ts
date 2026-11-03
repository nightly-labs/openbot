import { serveFakeAcpAgent } from "../acp-agent";

let count = 0;
serveFakeAcpAgent({
  initialize: (request, peer) => {
    if (request.params.clientCapabilities?._meta?.["com.nousresearch/backgroundReview"] !== true) {
      peer.fail(request, { code: -32602, message: "Review extension capability missing" });
      return;
    }
    peer.reply(request, {
      protocolVersion: 1,
      agentInfo: { name: "background-review", version: "1.0.0" },
      agentCapabilities: { loadSession: true },
      authMethods: [],
    });
  },
  "session/new": (request, peer) => peer.reply(request, { sessionId: `s-${process.pid}-${++count}` }),
  "session/prompt": (request, peer) => {
    const sessionId = request.params.sessionId;
    const during = request.params.prompt?.some((block) => block.text?.includes("during"));
    if (during) {
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method: "_com.nousresearch/backgroundReview",
          params: { sessionId, text: "Skill second patched" },
        })}\n`,
      );
      setTimeout(() => {
        peer.say(sessionId, "Second task done");
        peer.reply(request, { stopReason: "end_turn" });
      }, 200);
      return;
    }
    peer.say(sessionId, "Task done");
    peer.reply(request, { stopReason: "end_turn" });
    setTimeout(
      () =>
        process.stdout.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            method: "_com.nousresearch/backgroundReview",
            params: { sessionId, text: "Skill example patched" },
          })}\n`,
        ),
      200,
    );
  },
});
