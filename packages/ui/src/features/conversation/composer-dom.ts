import { serializeAttachmentReference } from "@openbot/contracts/attachment-references";
import { serializeChatTagReference } from "@openbot/contracts/chat-tag-references";
import { markdownListLineBreak } from "@openbot/contracts/markdown-lists";

export function serializeEditor(editor: HTMLDivElement): string {
  if (
    editor.textContent === "" &&
    !editor.querySelector("[data-mention-id], [data-skill-id], [data-mcp-id], [data-attachment-reference-id]")
  )
    return "";
  return Array.from(editor.childNodes).map(serializeNode).join("");
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof HTMLElement)) return "";
  if (node.dataset.composerTrailingLine !== undefined) return "";
  const attachmentId = node.dataset.attachmentReferenceId;
  const attachmentName = node.dataset.attachmentReferenceName;
  if (attachmentId && attachmentName) {
    return serializeAttachmentReference(attachmentName, attachmentId);
  }
  const mentionId = node.dataset.mentionId;
  const mentionName = node.dataset.mentionName;
  if (mentionId && mentionName) return serializeChatTagReference("agent", mentionName, mentionId);
  const skillId = node.dataset.skillId;
  const skillName = node.dataset.skillName;
  if (skillId && skillName) return serializeChatTagReference("skill", skillName, skillId);
  const mcpId = node.dataset.mcpId;
  const mcpName = node.dataset.mcpName;
  if (mcpId && mcpName) return serializeChatTagReference("mcp", mcpName, mcpId);
  if (node.tagName === "BR") return "\n";
  const content = Array.from(node.childNodes).map(serializeNode).join("");
  return node.tagName === "DIV" || node.tagName === "P" ? `${content}\n` : content;
}

/*
 * Writes through the browser's own editing command, so the change joins the undo stack: Ctrl+Z
 * still takes typing back, and still restores text a keystroke replaced. A range edit writes
 * nothing there. The command needs the caret inside this editor, and jsdom has no such command,
 * so it reports what it did and `insertPlainText` keeps a range edit for both cases.
 */
function insertTextThroughBrowser(editor: HTMLDivElement, text: string): boolean {
  // The command answers a newline with a block split, which serializes as two line breaks.
  if (text.includes("\n") || typeof document.execCommand !== "function") return false;
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (!range || !editor.contains(range.commonAncestorContainer)) return false;
  return document.execCommand("insertText", false, text);
}

export function insertPlainText(editor: HTMLDivElement, text: string): void {
  if (insertTextThroughBrowser(editor, text)) return;
  /*
   * The browser leaves a placeholder `<br>` behind when it empties the editable, and drops it only
   * when it writes text itself. The range edit below writes the text instead, so it drops the
   * placeholder: left in place beside the new text, it would serialize as a line break the user
   * never typed.
   */
  if (!editor.textContent) editor.querySelector(":scope > br:last-child")?.remove();
  const selection = window.getSelection();
  let range: Range;
  const selectedRange = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (selectedRange && editor.contains(selectedRange.commonAncestorContainer)) {
    range = selectedRange.cloneRange();
  } else {
    range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
  }

  const prefix = range.cloneRange();
  prefix.selectNodeContents(editor);
  prefix.setEnd(range.startContainer, range.startOffset);
  const caretOffset = prefix.toString().length + text.length;
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
  editor.normalize();
  syncTrailingLineSentinel(editor);
  const caretRange = rangeFromTextOffsets(editor, caretOffset, caretOffset);
  if (!caretRange) return;
  selection?.removeAllRanges();
  selection?.addRange(caretRange);
}

/*
 * Continues or ends a Markdown list, as `markdownListLineBreak` describes. The edit works in the
 * editor's text offsets, where a chip counts as its visible text, and it changes only the current
 * line, so chips stay in place.
 */
export function insertLineBreak(editor: HTMLDivElement): void {
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (!range?.collapsed || !editor.contains(range.commonAncestorContainer)) {
    insertPlainText(editor, "\n");
    return;
  }
  const before = range.cloneRange();
  before.selectNodeContents(editor);
  before.setEnd(range.startContainer, range.startOffset);
  const after = range.cloneRange();
  after.selectNodeContents(editor);
  after.setStart(range.endContainer, range.endOffset);
  const text = before.toString() + after.toString();
  const caret = before.toString().length;
  const edit = markdownListLineBreak(text, caret);
  if (!edit) {
    insertPlainText(editor, "\n");
    return;
  }
  if (edit.caret > caret) {
    insertPlainText(editor, edit.text.slice(caret, edit.caret));
    return;
  }
  const marker = rangeFromTextOffsets(editor, edit.caret, edit.caret + text.length - edit.text.length);
  if (!marker) return;
  selection?.removeAllRanges();
  selection?.addRange(marker);
  insertPlainText(editor, "");
}

export function syncTrailingLineSentinel(editor: HTMLDivElement, value = serializeEditor(editor)): void {
  const existing = editor.querySelector<HTMLElement>("[data-composer-trailing-line]");
  existing?.remove();
  if (!value.endsWith("\n")) return;

  const sentinel = document.createElement("span");
  sentinel.className = "composer-trailing-line";
  sentinel.dataset.composerTrailingLine = "";
  sentinel.contentEditable = "false";
  sentinel.setAttribute("aria-hidden", "true");
  editor.append(sentinel);
}

export function placeCaretAtEnd(editor: HTMLDivElement): void {
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function placeCaretAtChildOffset(container: Node, offset: number): void {
  const range = document.createRange();
  range.setStart(container, offset);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function mentionTokenAtCaretBoundary(
  editor: HTMLDivElement,
  range: Range,
  key: "Backspace" | "Delete",
): HTMLElement | null {
  const tokenAtCaret = closestMentionToken(range.startContainer, editor);
  if (tokenAtCaret) return tokenAtCaret;

  let candidate: Node | null = null;
  const container = range.startContainer;
  if (container === editor) {
    candidate = editor.childNodes[key === "Backspace" ? range.startOffset - 1 : range.startOffset] ?? null;
  } else if (container.nodeType === Node.TEXT_NODE) {
    const length = container.textContent?.length ?? 0;
    const atBoundary = key === "Backspace" ? range.startOffset === 0 : range.startOffset === length;
    if (!atBoundary) return null;
    const directChild = directChildOf(editor, container);
    candidate = key === "Backspace" ? (directChild?.previousSibling ?? null) : (directChild?.nextSibling ?? null);
  } else if (container instanceof HTMLElement) {
    candidate =
      container.childNodes[key === "Backspace" ? range.startOffset - 1 : range.startOffset] ??
      (key === "Backspace" ? container.previousSibling : container.nextSibling);
  }

  while (candidate?.nodeType === Node.TEXT_NODE && !candidate.textContent) {
    candidate = key === "Backspace" ? candidate.previousSibling : candidate.nextSibling;
  }
  return candidate ? closestMentionToken(candidate, editor) : null;
}

function closestMentionToken(node: Node, editor: HTMLDivElement): HTMLElement | null {
  const element = node instanceof HTMLElement ? node : node.parentElement;
  const token = element?.closest<HTMLElement>("[data-mention-id], [data-skill-id], [data-mcp-id]") ?? null;
  return token && editor.contains(token) ? token : null;
}

function directChildOf(editor: HTMLDivElement, node: Node): Node | null {
  let current: Node | null = node;
  while (current?.parentNode && current.parentNode !== editor) current = current.parentNode;
  return current?.parentNode === editor ? current : null;
}

export function automaticMentionSpaceAtCaretBoundary(
  editor: HTMLDivElement,
  range: Range,
): { text: Text; offset: number; token: HTMLElement } | null {
  const container = range.startContainer;
  let text: Text | null = null;
  let offset = 0;
  if (isTextNode(container)) {
    text = container;
    offset = range.startOffset;
    if (!offset && !text.data) {
      const candidate = previousNonemptySibling(text.previousSibling);
      if (!candidate || !isTextNode(candidate)) return null;
      text = candidate;
      offset = candidate.data.length;
    }
  } else if (container === editor) {
    const candidate = previousNonemptySibling(editor.childNodes[range.startOffset - 1] ?? null);
    if (!candidate || !isTextNode(candidate)) return null;
    text = candidate;
    offset = candidate.data.length;
  }

  if (!text || offset !== 1 || text.data[0] !== " ") return null;
  let previous = text.previousSibling;
  while (previous && isTextNode(previous) && !previous.data) previous = previous.previousSibling;
  const token = previous ? closestMentionToken(previous, editor) : null;
  return token ? { text, offset, token } : null;
}

function isTextNode(node: Node): node is Text {
  return node.nodeType === Node.TEXT_NODE;
}

function previousNonemptySibling(node: Node | null): Node | null {
  let candidate = node;
  while (candidate?.nodeType === Node.TEXT_NODE && !candidate.textContent) candidate = candidate.previousSibling;
  return candidate;
}

export function rangeFromTextOffsets(root: HTMLElement, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0;
  let startSet = false;
  let node = walker.nextNode();
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (!startSet && start <= offset + length) {
      range.setStart(node, Math.max(0, start - offset));
      startSet = true;
    }
    if (startSet && end <= offset + length) {
      range.setEnd(node, Math.max(0, end - offset));
      return range;
    }
    offset += length;
    node = walker.nextNode();
  }
  if (!startSet) range.setStart(root, root.childNodes.length);
  range.setEnd(root, root.childNodes.length);
  return range;
}
