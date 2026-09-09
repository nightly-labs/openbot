import { describe, expect, it } from "vitest";
import { codeLanguage, highlightCode } from "./code-highlight";

describe("mobile code blocks", () => {
  it("uses fence aliases and keeps an unknown language readable", async () => {
    expect([
      codeLanguage("javascript title=test"),
      codeLanguage("PYTHON"),
      codeLanguage("custom"),
      codeLanguage(),
    ]).toEqual([
      { language: "js", label: "JavaScript" },
      { language: "py", label: "Python" },
      { language: "plain", label: "custom" },
      { language: "plain", label: "Code" },
    ]);
    expect(await highlightCode("<example>\n  & text", "custom")).toEqual([
      { text: "<example>\n  & text", offset: 0, type: undefined },
    ]);
  });
  it("highlights JavaScript without changing spaces, newlines, or the code to copy", async () => {
    const text = 'const message = "hello";\n  console.log(message);\n';
    const tokens = await highlightCode(text, "javascript");
    expect(tokens.map((token) => token.text).join("")).toBe(text);
    expect(
      tokens.filter((token) => token.type === "kwd" || token.type === "str").map((token) => [token.text, token.type]),
    ).toEqual([
      ["const", "kwd"],
      ['"hello"', "str"],
    ]);
  });
});
