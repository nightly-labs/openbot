// @vitest-environment node

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { extractJsonObject, StructuredOutputError, structuredOutput } from "./structured-output";

/** The four channel routing decisions. This is the shape `ChannelService.pump` asks the lead for. */
const routing = structuredOutput(
  z.union([
    z.strictObject({ agentId: z.string().min(1) }),
    z.strictObject({ taskId: z.string().min(1) }),
    z.strictObject({ question: z.string().min(1).max(2000) }),
    z.strictObject({ idle: z.literal(true) }),
  ]),
);

describe("extractJsonObject", () => {
  it("reads a bare object, a fenced object, and an object after prose", () => {
    expect(extractJsonObject('{"agentId":"agent-a"}')).toEqual({ agentId: "agent-a" });
    expect(extractJsonObject('```json\n{"agentId":"agent-a"}\n```')).toEqual({ agentId: "agent-a" });
    expect(extractJsonObject('Builder owns the front end. {"agentId":"agent-a"}')).toEqual({ agentId: "agent-a" });
  });

  it("keeps a brace inside a string", () => {
    expect(extractJsonObject('Here: {"question":"which one, a } b?"}')).toEqual({ question: "which one, a } b?" });
  });

  it("rejects a reply with no object and a reply that is not an object", () => {
    expect(() => extractJsonObject("Builder should do it.")).toThrow(StructuredOutputError);
    expect(() => extractJsonObject('["agent-a"]')).toThrow(StructuredOutputError);
  });
});

describe("structuredOutput", () => {
  it("puts the accepted shapes in the prompt", () => {
    const described = routing.describe();

    expect(described).toContain("agentId");
    expect(described).toContain("idle");
    expect(described).toContain("additionalProperties");
  });

  it("parses each accepted decision", () => {
    expect(routing.parse('{"agentId":"agent-a"}')).toEqual({ agentId: "agent-a" });
    expect(routing.parse('{"taskId":"task-a"}')).toEqual({ taskId: "task-a" });
    expect(routing.parse('{"question":"Which report?"}')).toEqual({ question: "Which report?" });
    expect(routing.parse('{"idle":true}')).toEqual({ idle: true });
  });

  it("rejects an extra key, two decisions at once, and an empty object", () => {
    expect(() => routing.parse('{"agentId":"agent-a","reason":"front end"}')).toThrow(StructuredOutputError);
    expect(() => routing.parse('{"agentId":"agent-a","taskId":"task-a"}')).toThrow(StructuredOutputError);
    expect(() => routing.parse("{}")).toThrow(StructuredOutputError);
  });
});
