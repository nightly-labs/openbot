import { redactText, registerSecretValue } from "@openbot/logging";
import { describe, expect, it } from "vitest";
import { redactMcpModelText, redactMcpRecord } from "./mcp-redaction";

describe("Pi reply text in the chat", () => {
  registerSecretValue("pazq", { allowShort: true });

  it("keeps a word that has a saved value inside it", () => {
    expect(redactMcpModelText("Let me bypazq the compazq-based check.", [])).toBe(
      "Let me bypazq the compazq-based check.",
    );
  });

  it("masks a saved value that stands alone as a word", () => {
    expect(redactMcpModelText("The password is pazq.", [])).toBe("The password is [redacted].");
  });

  it("masks a known key format and a value of the agent's apps", () => {
    expect(redactMcpModelText("Key sk-ant-api03-abcdefghijkl, header magpie-token-77", ["magpie-token-77"])).toBe(
      "Key [redacted], header •••",
    );
  });

  it("keeps the full rule for logs and tool output", () => {
    expect(redactText("Let me bypazq it.")).toBe("Let me [redacted] it.");
    expect(redactMcpRecord({ output: "bypazq" }, [])).toEqual({ output: "[redacted]" });
  });
});
