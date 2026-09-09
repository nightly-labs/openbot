import { chatTagReferences } from "@openbot/contracts/chat-tag-references";
import { Marked } from "marked";

export const markdown = new Marked({
  gfm: true,
  breaks: true,
  extensions: [
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
