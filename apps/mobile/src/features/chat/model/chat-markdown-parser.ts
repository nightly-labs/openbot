import { blockChatMath, chatMathBlockStart, chatMathStart, inlineChatMath } from "@openbot/contracts/chat-math";
import { chatTagReferences } from "@openbot/contracts/chat-tag-references";
import { Marked } from "marked";

export const markdown = new Marked({
  gfm: true,
  breaks: true,
  extensions: [
    {
      name: "blockMath",
      level: "block",
      start: chatMathBlockStart,
      tokenizer(source) {
        const math = blockChatMath(source);
        if (math) return { type: "blockMath", raw: math.raw, text: math.tex, display: true };
      },
    },
    {
      name: "inlineMath",
      level: "inline",
      start: chatMathStart,
      tokenizer(source) {
        const math = inlineChatMath(source);
        if (math) return { type: "inlineMath", raw: math.raw, text: math.tex, display: math.display };
      },
    },
    {
      name: "agentMention",
      level: "inline",
      start: (source) => source.indexOf("@["),
      tokenizer(source) {
        const reference = chatTagReferences(source)[0];
        if (reference?.start === 0 && reference.kind === "agent")
          return { type: "agentMention", raw: source.slice(0, reference.end) };
      },
    },
  ],
});

export function parseChatMarkdown(body: string) {
  return markdown.lexer(body);
}
