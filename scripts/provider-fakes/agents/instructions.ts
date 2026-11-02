// The agents of `acp-instructions-once-e2e.ts`. Each prompt logs whether its first block carries the
// OpenBot instructions. `FAKE_MODE` picks one: "context" reports its context size after each prompt,
// as OpenCode does; "silent" reports none. A prompt that says "compact-now" shrinks the context,
// "compaction-update" reports a completed compaction, and "fail-now" fails.
import { randomUUID } from "node:crypto";
import { type AcpHandler, logEntry, serveFakeAcpAgent } from "../acp-agent";

const INSTRUCTIONS_TAG = "<openbot-developer-instructions>";
const mode = process.env.FAKE_MODE;
const contexts = new Map<string, number>();

const session: AcpHandler = (request, peer) => {
  if (request.method === "session/new") peer.reply(request, { sessionId: randomUUID() });
  else peer.reply(request, {});
};

serveFakeAcpAgent({
  initialize: (request, peer) =>
    peer.reply(request, {
      protocolVersion: 1,
      agentInfo: { name: "fake", title: mode, version: "1.0.0" },
      agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } },
    }),
  "session/new": session,
  "session/load": session,
  "session/resume": session,
  "session/prompt": (request, peer) => {
    const sessionId = request.params.sessionId ?? "";
    const blocks = request.params.prompt ?? [];
    const first = blocks[0]?.text ?? "";
    const instructions = first.startsWith(INSTRUCTIONS_TAG);
    const text = blocks
      .slice(instructions ? 1 : 0)
      .map((block) => block.text ?? "")
      .join("");
    logEntry({ sessionId, instructions, instructionsText: instructions ? first : null, text });
    if (text.includes("fail-now")) {
      peer.fail(request, { code: -32603, message: "Internal error", data: "the model failed" });
      return;
    }
    peer.say(sessionId, "OK");
    if (mode === "context") {
      const used = text.includes("compact-now")
        ? 500
        : (contexts.get(sessionId) ?? 0) + 1_000 + (instructions ? first.length : 0);
      contexts.set(sessionId, used);
      peer.update(sessionId, { sessionUpdate: "usage_update", used, size: 200_000 });
      if (text.includes("compaction-update"))
        peer.update(sessionId, { sessionUpdate: "compaction_update", compactionId: "c-1", status: "completed" });
    }
    peer.reply(request, { stopReason: "end_turn" });
  },
});
