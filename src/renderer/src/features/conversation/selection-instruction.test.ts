import { describe, expect, it } from "vitest";
import { parseSelectionInstruction, serializeSelectionInstruction } from "./SelectionActions";

describe("selection instruction messages", () => {
  it("serializes and parses multiline quotes", () => {
    const body = serializeSelectionInstruction("Make this clearer.", "First line\n\nSecond line");

    expect(body).toBe("Make this clearer.\n\n> First line\n> \n> Second line");
    expect(parseSelectionInstruction(body)).toEqual({
      instruction: "Make this clearer.",
      quote: "First line\n\nSecond line",
    });
  });

  it("ignores ordinary blockquotes without an instruction", () => {
    expect(parseSelectionInstruction("> Just a quote")).toBeNull();
    expect(parseSelectionInstruction("Question\n\nNot a quote")).toBeNull();
  });
});
