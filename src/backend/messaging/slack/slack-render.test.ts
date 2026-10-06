import { describe, expect, it } from "vitest";
import { slackChunks, slackMrkdwn } from "./slack-render";

describe("slackMrkdwn", () => {
  it("makes an answer unable to ping the workspace or a person", () => {
    expect(slackMrkdwn("Hi <!channel> and <@U123> & <!here>")).toBe(
      "Hi &lt;!channel&gt; and &lt;@U123&gt; &amp; &lt;!here&gt;",
    );
  });

  it("turns markdown into mrkdwn and leaves code as it is", () => {
    expect(
      slackMrkdwn("# Plan\n- **bold** and *italic* [docs](https://example.com)\n```ts\nconst a = 1 < 2;\n```"),
    ).toBe("*Plan*\n• *bold* and _italic_ <https://example.com|docs>\n```\nconst a = 1 &lt; 2;\n```");
  });
});

describe("slackChunks", () => {
  it("closes a code block at a split and opens it again in the next post", () => {
    const text = ["intro", "```", ...Array.from({ length: 40 }, (_, index) => `line ${index}`), "```"].join("\n");
    const chunks = slackChunks(text, 120);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(120);
      expect((chunk.match(/```/g) ?? []).length % 2).toBe(0);
    }
    expect(chunks.join("\n")).toContain("line 39");
  });
});
