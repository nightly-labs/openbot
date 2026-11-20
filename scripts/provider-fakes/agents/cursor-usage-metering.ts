import { logEntry, serveFakeAcpAgent } from "../acp-agent";

const MODEL = "composer-2.5";
let count = 0;

function promptText(params: { prompt?: { text?: string }[] }): string {
  return (params.prompt ?? []).map((block) => block.text ?? "").join("");
}

serveFakeAcpAgent({
  initialize: (request, peer) =>
    peer.reply(request, {
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, clientCapabilities: { _meta: { parameterizedModelPicker: true } } },
      authMethods: [],
    }),
  "session/new": (request, peer) => {
    count += 1;
    peer.reply(request, {
      sessionId: `s-${process.pid}-${count}`,
      models: { availableModels: [{ modelId: MODEL, name: "Composer 2.5" }], currentModelId: MODEL },
    });
  },
  "session/resume": (request, peer) =>
    peer.reply(request, { sessionId: request.params.sessionId ?? "", models: { currentModelId: MODEL } }),
  "session/prompt": (request, peer) => {
    const text = promptText(request.params);
    logEntry({ prompt: text });
    const meta = /meta\s+tokens=(\d+),(\d+),(\d+),(\d+)/u.exec(text);
    const update = /update\s+tokens=(\d+),(\d+),(\d+),(\d+)/u.exec(text);
    const plain = /tokens=(\d+),(\d+),(\d+),(\d+)/u.exec(text);
    peer.say(request.params.sessionId, "Done.");
    if (update) {
      const input = Number(update[1]);
      const cached = Number(update[2]);
      const written = Number(update[3]);
      const output = Number(update[4]);
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: request.params.sessionId,
            update: {
              sessionUpdate: "usage_update",
              used: input + cached + written + output,
              size: 200_000,
              _meta: {
                usage: {
                  inputTokens: input,
                  outputTokens: output,
                  cachedReadTokens: cached,
                  cachedWriteTokens: written,
                },
              },
            },
          },
        })}\n`,
      );
      return peer.reply(request, { stopReason: "end_turn" });
    }
    if (meta) {
      const [input, cached, written, output] = meta.slice(1).map(Number);
      return peer.reply(request, {
        stopReason: "end_turn",
        _meta: {
          usage: {
            inputTokens: input,
            outputTokens: output,
            cachedReadTokens: cached,
            cachedWriteTokens: written,
          },
        },
      });
    }
    if (plain) {
      const [input, cached, written, output] = plain.slice(1).map(Number);
      return peer.reply(request, {
        stopReason: "end_turn",
        usage: { inputTokens: input, outputTokens: output, cachedReadTokens: cached, cachedWriteTokens: written },
      });
    }
    peer.reply(request, { stopReason: "end_turn" });
  },
});
