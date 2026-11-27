// The `opencode acp` of `opencode-question-e2e.ts`. The prompt `tool` writes text, runs a `read` tool
// and answers. A prompt `ask ...` writes text and then asks with OpenCode's `question` tool: a
// `tool_call` with the name `question`, then an `elicitation/create` form in the shape of OpenCode 2.2.5.
// Each choice field `qN` with a typed answer has a text field `qN_custom`. The fake logs the reply. An
// accepted reply gets more text, and a declined reply ends the turn, as OpenCode does. The word
// `required` makes `q2` required, `plain` asks the form of `PLAIN`, `many` asks the seven choices of
// `MANY`, `many-multi` asks the same seven as the multi-select of `MANY_MULTI`, and `step` runs a
// `read` tool first.
import { logEntry, serveFakeAcpAgent } from "../acp-agent";

const MODEL = "opencode/big-pickle";

/** OpenCode's form for four questions: a single choice, a multiple choice, a choice with no typed answer, and a lone `_custom` text field. */
const SCHEMA = {
  type: "object",
  properties: {
    q0: {
      type: "string",
      title: "Color",
      description: "Which color?",
      oneOf: [
        { const: "red", title: "Red", description: "Warm" },
        { const: "blue", title: "Blue", description: "Cold" },
      ],
    },
    q0_custom: { type: "string", title: "Color (other)", description: "Type your own answer" },
    q1: {
      type: "array",
      title: "Sizes",
      description: "Which sizes?",
      items: {
        anyOf: [
          { const: "small", title: "Small", description: "S" },
          { const: "large", title: "Large", description: "L" },
        ],
      },
    },
    q1_custom: { type: "string", title: "Sizes (other)", description: "Add your own answer" },
    q2: {
      type: "string",
      title: "Ship",
      description: "Ship today?",
      oneOf: [
        { const: "yes", title: "Yes" },
        { const: "no", title: "No" },
      ],
    },
    q3_custom: { type: "string", title: "Note (other)", description: "Any note?" },
  },
};

/**
 * A list of choices with no `_custom` field, and a single choice with no `_custom` field. The ACP SDK
 * drops `anyOf` from a string field, so that single choice comes as `oneOf`.
 */
const PLAIN = {
  type: "object",
  properties: {
    q1: SCHEMA.properties.q1,
    q4: {
      type: "string",
      title: "Size",
      description: "Which size?",
      oneOf: [
        { const: "small", title: "Small" },
        { const: "large", title: "Large" },
      ],
    },
  },
};

/** Seven choices with a `_custom` field: more than the card shows, so the tail goes into the detail. */
const MANY = {
  type: "object",
  properties: {
    q5: {
      type: "string",
      title: "Region",
      description: "Which region?",
      oneOf: Array.from({ length: 7 }, (_, index) => ({
        const: `r${index + 1}`,
        title: `Region ${index + 1}`,
      })),
    },
    q5_custom: { type: "string", title: "Region (other)", description: "Type your own answer" },
  },
};

/** The same seven choices as a list: a multi-select page, with its `_custom` field for a typed answer. */
const MANY_MULTI = {
  type: "object",
  properties: {
    q6: {
      type: "array",
      title: "Regions",
      description: "Which regions?",
      items: {
        anyOf: Array.from({ length: 7 }, (_, index) => ({
          const: `r${index + 1}`,
          title: `Region ${index + 1}`,
        })),
      },
    },
    q6_custom: { type: "string", title: "Regions (other)", description: "Add your own answer" },
  },
};

let count = 0;
let calls = 0;
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
    calls += 1;
    const toolCallId = `call-${calls}`;
    const words = new Set(prompt.split(/\s+/u));
    const read = () => {
      peer.say(sessionId, "Let me look.");
      peer.update(sessionId, {
        sessionUpdate: "tool_call",
        toolCallId: `${toolCallId}-read`,
        title: "read",
        kind: "read",
        status: "pending",
        rawInput: {},
      });
      peer.update(sessionId, {
        sessionUpdate: "tool_call_update",
        toolCallId: `${toolCallId}-read`,
        status: "completed",
        rawOutput: {},
      });
    };
    if (words.has("tool")) {
      read();
      peer.say(sessionId, "Done.");
      peer.reply(request, { stopReason: "end_turn" });
      return;
    }
    if (words.has("step")) read();
    peer.say(sessionId, "Here is my plan.");
    // OpenCode 2.x sends the tool name in `name`, and in `title` while the call is pending.
    peer.update(sessionId, {
      sessionUpdate: "tool_call",
      toolCallId,
      name: "question",
      title: "question",
      kind: "other",
      status: "pending",
      rawInput: {},
    });
    void peer
      .ask("elicitation/create", {
        sessionId,
        toolCallId,
        mode: "form",
        message: "Please answer the questions.",
        requestedSchema: words.has("plain")
          ? PLAIN
          : words.has("many-multi")
            ? MANY_MULTI
            : words.has("many")
              ? MANY
              : words.has("required")
                ? { ...SCHEMA, required: ["q2"] }
                : SCHEMA,
      })
      .then((reply) => {
        logEntry({ event: "reply", sessionId, text: JSON.stringify(reply) });
        const accepted = typeof reply === "object" && reply !== null && "action" in reply && reply.action === "accept";
        peer.update(sessionId, {
          sessionUpdate: "tool_call_update",
          toolCallId,
          status: accepted ? "completed" : "failed",
          rawOutput: {},
        });
        if (accepted) peer.say(sessionId, "Thanks.");
        peer.reply(request, { stopReason: "end_turn" });
      });
  },
});
