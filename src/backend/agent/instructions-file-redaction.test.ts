import { registerSecretValue } from "@openbot/logging";
import { describe, expect, it } from "vitest";
import { instructionsFileUpdate } from "./developer-instructions";

function sentText(text: string): string {
  return instructionsFileUpdate(null, { fileName: "AGENTS.md", text, truncated: false }) ?? "";
}

describe("instruction file sent to the model", () => {
  registerSecretValue("ketoxq", { allowShort: true });

  it("keeps a word that has a saved value inside it", () => {
    expect(sentText("Low-carb and ketoxqgenic diets at the clinic")).toContain(
      "Low-carb and ketoxqgenic diets at the clinic",
    );
  });

  it("masks a saved value that stands alone as a word", () => {
    const sent = sentText("Use ketoxq to sign in.");
    expect(sent).toContain("Use [redacted] to sign in.");
    expect(sent).not.toContain("ketoxq");
  });

  it("masks a known key format", () => {
    const sent = sentText("The key is sk-ant-api03-abcdefghijkl and it is new.");
    expect(sent).toContain("The key is [redacted] and it is new.");
    expect(sent).not.toContain("sk-ant-api03");
  });
});
