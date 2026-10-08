import { describe, expect, it } from "vitest";
import { markdownPreviewText } from "./markdown-preview-text";

describe("markdown preview text", () => {
  it("removes inline marks and keeps their text", () => {
    expect(markdownPreviewText("**2 new emails**, both _the same_ and `code` ~~gone~~ __bold__")).toBe(
      "2 new emails, both the same and code gone bold",
    );
  });

  it("flattens blocks into one line", () => {
    const body = [
      "# Inbox",
      "",
      "> Quoted line",
      "",
      "- first",
      "- [x] second",
      "",
      "1. third",
      "",
      "```ts",
      "const a = 1;",
      "```",
      "",
      "| Name | Count |",
      "| --- | --- |",
      "| Mail | 2 |",
    ].join("\n");
    expect(markdownPreviewText(body)).toBe("Inbox Quoted line first second third const a = 1; Name Count Mail 2");
  });

  it("shows link and image text without the address, and drops HTML tags", () => {
    expect(markdownPreviewText("See [the docs](https://example.com) ![chart](chart.png) <b>now</b>")).toBe(
      "See the docs chart now",
    );
  });

  it("keeps identifiers and arithmetic as written", () => {
    expect(markdownPreviewText("Set snake_case_name to 2*3*4, not 2*3")).toBe("Set snake_case_name to 2*3*4, not 2*3");
  });

  it("shows mentions by name", () => {
    expect(markdownPreviewText("Ask **@[Chief](agent:chief)** to use @[Release Notes](skill:notes)")).toBe(
      "Ask @Chief to use Release Notes (skill)",
    );
  });
});
