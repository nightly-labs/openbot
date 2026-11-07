// The error of a failed tool step goes to the renderer, to Team API clients and to the trace. The
// text must be redacted before the cut, so a secret that the cut divides does not show half of it.
import { CONVERSATION_TRACE_TEXT_LIMIT } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { redactMcpValues } from "../mcp-redaction";
import type { ThreadItem } from "../protocol";
import { toolFailureText } from "./thread-items";

const secret = "tok_9f8e7d6c5b4a3210";
const redact = (text: string) => redactMcpValues(text, [secret]);

function item(fields: { type: string; status: string; [key: string]: unknown }): ThreadItem {
  return { id: "item-1", ...fields };
}

describe("toolFailureText", () => {
  it("gives no text for a step that did not fail", () => {
    expect(toolFailureText(item({ type: "mcpToolCall", status: "completed", error: secret }), redact)).toBeNull();
  });

  it("masks a secret in the error of a failed tool", () => {
    const text = toolFailureText(
      item({ type: "mcpToolCall", status: "failed", error: { message: `401 for key ${secret}` } }),
      redact,
    );
    expect(text).toBe("401 for key •••");
  });

  it("masks a secret that the cut would divide", () => {
    const filler = "x".repeat(CONVERSATION_TRACE_TEXT_LIMIT - 8);
    const text = toolFailureText(
      item({ type: "dynamicToolCall", status: "failed", result: `${filler}${secret}` }),
      redact,
    );
    expect(text).toBe(`${filler}•••`);
    expect(text?.length).toBeLessThanOrEqual(CONVERSATION_TRACE_TEXT_LIMIT);
  });

  it("keeps the end of a long command output, where the error is", () => {
    const output = `${"line\n".repeat(CONVERSATION_TRACE_TEXT_LIMIT)}npm ERR! token ${secret} is not valid`;
    const text = toolFailureText(item({ type: "toolCall", name: "Bash", status: "failed", error: output }), redact);
    expect(text?.endsWith("npm ERR! token ••• is not valid")).toBe(true);
    expect(text?.length).toBe(CONVERSATION_TRACE_TEXT_LIMIT);
  });
});
