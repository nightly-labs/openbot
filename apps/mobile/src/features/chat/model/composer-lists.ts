import { type MarkdownListEdit, markdownListLineBreak } from "@openbot/contracts/markdown-lists";
import { editMentionDraft } from "./chat-mentions";

export function markdownListReturn(previous: string, next: string, caret: number): MarkdownListEdit | null {
  if (caret < 0 || next !== `${previous.slice(0, caret)}\n${previous.slice(caret)}`) return null;
  return markdownListLineBreak(previous, caret);
}

export function applyMarkdownListEdit(source: string, previous: string, caret: number, edit: MarkdownListEdit): string {
  if (edit.caret <= caret) return editMentionDraft(source, edit.text);

  let result = source;
  let visible = previous;
  for (const replacement of edit.replacements?.toReversed() ?? []) {
    const next = visible.slice(0, replacement.start) + replacement.text + visible.slice(replacement.end);
    result = editMentionDraft(result, next);
    visible = next;
  }
  const insert = edit.text.slice(caret, edit.caret);
  const next = visible.slice(0, caret) + insert + visible.slice(caret);
  return editMentionDraft(result, next);
}
