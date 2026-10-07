import { describe, expect, it } from "vitest";
import { plainText, telegramChunks, telegramHtml } from "./telegram-render";

describe("telegramHtml", () => {
  it("escapes raw HTML tags so they do not break Telegram parsing", () => {
    expect(telegramHtml("<b>hello</b> <script>alert(1)</script>")).toBe(
      "&lt;b&gt;hello&lt;/b&gt; &lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  it("converts bold, italic, and strikethrough", () => {
    expect(telegramHtml("**bold** and *italic* and ~strike~")).toBe("<b>bold</b> and <i>italic</i> and <s>strike</s>");
  });

  it("converts markdown links to html anchors", () => {
    expect(telegramHtml("[OpenBot](https://openbot.sh)")).toBe('<a href="https://openbot.sh">OpenBot</a>');
  });

  it("converts inline code and code blocks", () => {
    expect(telegramHtml("run `openbot start`\n```bash\necho 1 < 2\n```")).toBe(
      'run <code>openbot start</code>\n<pre><code class="language-bash">echo 1 &lt; 2</code></pre>',
    );
  });
});

describe("telegramChunks", () => {
  it("returns single chunk when within limit", () => {
    expect(telegramChunks("short text", 100)).toEqual(["short text"]);
  });

  it("splits long messages on paragraph or newline boundaries", () => {
    const text = Array.from({ length: 20 }, (_, i) => `Paragraph ${i}`).join("\n\n");
    const chunks = telegramChunks(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100);
    }
  });

  it("handles splitting across code blocks", () => {
    const lines = ["```", ...Array.from({ length: 30 }, (_, i) => `line ${i}`), "```"].join("\n");
    const chunks = telegramChunks(lines, 80);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(80);
      expect((chunk.match(/```/g) ?? []).length % 2).toBe(0);
    }
  });
});

describe("plainText", () => {
  it("strips bot mentions", () => {
    expect(plainText("/start @MyTestBot do something", "@MyTestBot")).toBe("/start do something");
    expect(plainText("@MyTestBot hello", "MyTestBot")).toBe("hello");
  });
});
