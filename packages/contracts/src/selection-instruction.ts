import { limitedQuoteText, serializeChatTagReference } from "./chat-tag-references";

export const SELECTION_ACTION_INSTRUCTIONS = {
  Explain: "Explain this selected text.",
  Improve: "Improve this selected text.",
  Shorten: "Shorten this selected text.",
  Tone: "Change the tone of this selected text.",
  Grammar: "Fix the grammar in this selected text.",
} as const;

export type SelectionAction = keyof typeof SELECTION_ACTION_INSTRUCTIONS;

export interface SelectionInstruction {
  instruction: string;
  quote: string;
}

export function serializeSelectionInstruction(instruction: string, quote: string): string {
  const normalizedInstruction = instruction.trim();
  const normalizedQuote = quote.replace(/\r\n?/gu, "\n").trim();
  const quoted = normalizedQuote
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `${normalizedInstruction}\n\n${quoted}`;
}

export function serializeFileSelectionInstruction(instruction: string, quote: string, quoteId: string): string {
  return `${serializeChatTagReference("quote", limitedQuoteText(quote.trim()), quoteId)}\n\n${instruction.trim()}`;
}

export function parseSelectionInstruction(body: string): SelectionInstruction | null {
  const separator = body.lastIndexOf("\n\n>");
  if (separator <= 0) return null;
  const instruction = body.slice(0, separator).trim();
  const quoteLines = body.slice(separator + 2).split("\n");
  if (!instruction || quoteLines.length === 0 || quoteLines.some((line) => !/^>(?: |$)/u.test(line))) return null;
  const quote = quoteLines
    .map((line) => line.replace(/^> ?/u, ""))
    .join("\n")
    .trim();
  return quote ? { instruction, quote } : null;
}
