import { limitedQuoteText, serializeChatTagReference } from "./chat-tag-references";

/**
 * A message that asks an agent to change or explain part of an earlier message. Desktop and
 * mobile send the same body, a reply to the quoted message, so each client shows the quote of the
 * other. The instructions stay in English: they are for the model, not for the reader.
 */
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

/**
 * A passage of a file is a quote tag, so the agent reads the file path and lines with the text. The
 * message is not a reply: no message holds the passage.
 */
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
