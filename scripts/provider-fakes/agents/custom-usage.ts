// The custom agent of `custom-agent-usage-metering-e2e.ts`. It reports session-total usage as the
// ACP contract documents it (#4181): the `usage_update` before the result carries the session's
// total cost in USD, and the `PromptResponse.usage` counts are the session's totals, with the
// uncached input reported on its own and `cachedReadTokens` and `cachedWriteTokens` left out when
// they are 0. A message `tokens=<input>,<cached>,<written>,<output>` adds those counts to its
// session, and `cost=<total>` makes the `usage_update` carry that session cost.
import { type LogValue, logEntry, serveFakeAcpAgent } from "../acp-agent";

const log = (entry: Readonly<Record<string, LogValue>>) => logEntry({ pid: process.pid, ...entry });
log({ event: "start" });

let sessions = 0;
const total = { input: 0, cached: 0, written: 0, output: 0 };
serveFakeAcpAgent(
  {
    initialize: (request, peer) =>
      peer.reply(request, {
        protocolVersion: 1,
        agentInfo: { name: "fake", title: "Usage meter", version: "18.14.1" },
        agentCapabilities: { loadSession: true },
      }),
    "session/new": (request, peer) => {
      sessions += 1;
      peer.reply(request, {
        sessionId: `s-${sessions}`,
        models: { availableModels: [{ modelId: "main", name: "Main" }], currentModelId: "main" },
      });
    },
    "session/prompt": (request, peer) => {
      const text = (request.params.prompt ?? [])
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join(" ");
      peer.say(request.params.sessionId, "Done.");
      const match = /tokens=(\d+),(\d+),(\d+),(\d+)/.exec(text);
      if (!match) return peer.reply(request, { stopReason: "end_turn" });
      const count = (index: number) => Number(match[index] ?? 0);
      total.input += count(1);
      total.cached += count(2);
      total.written += count(3);
      total.output += count(4);
      const cost = /cost=([\d.]+)/.exec(text);
      if (cost)
        peer.update(request.params.sessionId, {
          sessionUpdate: "usage_update",
          used: total.input + total.cached + total.written + total.output,
          size: 200000,
          cost: { amount: Number(cost[1] ?? 0), currency: "USD" },
        });
      return peer.reply(request, {
        stopReason: "end_turn",
        usage: {
          inputTokens: total.input,
          outputTokens: total.output,
          totalTokens: total.input + total.cached + total.written + total.output,
          ...(total.cached > 0 ? { cachedReadTokens: total.cached } : {}),
          ...(total.written > 0 ? { cachedWriteTokens: total.written } : {}),
        },
      });
    },
  },
  {
    onRequest: (request) =>
      log({ event: "request", method: request.method, sessionId: request.params.sessionId ?? null }),
  },
);
