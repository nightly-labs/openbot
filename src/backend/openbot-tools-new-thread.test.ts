// @vitest-environment node
// The `send_message` schema keeps every old call valid, and the optional `newThread` field that
// starts an independent thread per recipient (#8134) reaches the advertised JSON schema that the
// providers read.
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { OPENBOT_DYNAMIC_TOOLS, OPENBOT_TOOL_DEFINITIONS } from "./openbot-tools";

const definition = OPENBOT_TOOL_DEFINITIONS.find((tool) => tool.name === "send_message");
if (!definition) throw new Error("The send_message tool definition is missing.");
const callSchema = z.strictObject(definition.shape);

const { inputSchema } = OPENBOT_DYNAMIC_TOOLS.tools.find((tool) => tool.name === "send_message") ?? {};
if (!isDynamicRecord(inputSchema)) throw new Error("The advertised send_message schema is missing.");
const { properties, required } = inputSchema;
if (!isDynamicRecord(properties) || !isDynamicRecord(properties.newThread) || !Array.isArray(required))
  throw new Error("The advertised send_message schema is not in the expected shape.");
const newThreadProperty = properties.newThread;

describe("send_message schema", () => {
  it("keeps every old call valid", () => {
    expect(callSchema.safeParse({ recipientAgentIds: ["agent-b"], text: "Please review." }).success).toBe(true);
    expect(
      callSchema.safeParse({
        recipientAgentIds: ["agent-b"],
        text: "Please review.",
        paths: ["/tmp/notes.md"],
        replyToMessageId: null,
        expectsReply: false,
      }).success,
    ).toBe(true);
  });

  it("takes the optional boolean newThread field and refuses other values", () => {
    expect(
      callSchema.safeParse({ recipientAgentIds: ["agent-b"], text: "Please review.", newThread: true }).success,
    ).toBe(true);
    const refused = callSchema.safeParse({ recipientAgentIds: ["agent-b"], text: "Please review.", newThread: "yes" });
    expect(refused.success).toBe(false);
  });

  it("advertises newThread as an optional boolean beside the old fields", () => {
    expect(newThreadProperty.type).toBe("boolean");
    expect(required).toContain("recipientAgentIds");
    expect(required).toContain("text");
    expect(required).not.toContain("newThread");
    expect(Object.keys(properties)).toEqual(expect.arrayContaining(["recipientAgentIds", "text", "newThread"]));
  });
});
