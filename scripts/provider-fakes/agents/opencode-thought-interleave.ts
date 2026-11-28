import { serveFakeAcpAgent } from "../acp-agent";

const MODEL = "opencode/big-pickle";
const TOKENS = [
  "B",
  "aca",
  " gambar",
  ".",
  " G",
  "ambar",
  ":",
  " tabel",
  " R",
  "enc",
  "ana",
  " (",
  "prot",
  "otype",
  ").",
];

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
  "session/prompt": (request, peer) => {
    const { sessionId } = request.params;
    const prompt = request.params.prompt?.map((part) => part.text ?? "").join("") ?? "";
    const message = (messageId: string, text: string) =>
      peer.update(sessionId, { sessionUpdate: "agent_message_chunk", messageId, content: { type: "text", text } });
    if (prompt.includes("tagged")) {
      for (const text of ["\n<thi", "nking>Plan the", " reply.</thin", "king>\n", "\nClean answer."])
        message("m-tagged", text);
    } else if (prompt.includes("messages")) {
      for (const text of ["<think>First plan.</think>", "First part."]) message("m-first", text);
      for (const text of ["<think>Second", " plan.</think>\n\nSecond part."]) message("m-second", text);
    } else if (prompt.includes("unclosed")) {
      for (const text of ["<think>Never", " closed."]) message("m-unclosed", text);
    } else if (prompt.includes("mention")) {
      for (const text of ["Use the <think> tag ", "like this.", " <thinker> stays."]) message("m-mention", text);
    } else if (prompt.includes("tool first")) {
      peer.update(sessionId, {
        sessionUpdate: "tool_call",
        toolCallId: "t-first",
        title: "read",
        kind: "read",
        status: "completed",
      });
      message("m-tool", "<think>The file is read.</think>Answer after the tool.");
    } else if (prompt.includes("broken")) {
      message("m-broken", "<think>Partial");
      message("m-broken", "API Error: The stream ended. The response above may be incomplete.");
      message("m-broken", "<think>Plan.</think>Full answer.");
    } else if (prompt.includes("harness")) {
      peer.say(sessionId, "Partial ans");
      peer.say(sessionId, "API Error: The stream ended. The response above may be incomplete.");
      peer.say(sessionId, "Full answer.");
    } else {
      for (const [index, token] of TOKENS.entries()) {
        peer.say(sessionId, token);
        if (index % 3 === 0)
          peer.update(sessionId, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hmm" } });
      }
    }
    peer.reply(request, { stopReason: "end_turn" });
  },
});
