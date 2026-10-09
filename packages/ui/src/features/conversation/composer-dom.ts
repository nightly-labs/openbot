import { serializeAttachmentReference } from "@openbot/contracts/attachment-references";
import { serializeChatTagReference } from "@openbot/contracts/chat-tag-references";
import { markdownListLineBreak } from "@openbot/contracts/markdown-lists";

export function serializeEditor(editor: HTMLDivElement): string {
  return Array.from(editor.childNodes).map(serializeNode).join("");
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof HTMLElement)) return "";
  if (isTrailingPlaceholder(node)) return "";
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

/* Use native edits for typing, paste, and line breaks so they share the undo history.
 * insertText splits multiline text into blocks. Escaped insertHTML keeps literal newlines. */
function insertTextThroughBrowser(editor: HTMLDivElement, text: string): boolean {
  if (typeof document.execCommand !== "function") return false;
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (!range || !editor.contains(range.commonAncestorContainer)) return false;
  if (!text) return document.execCommand("delete", false);
  if (!text.includes("\n")) return document.execCommand("insertText", false, text);
  const escaped = document.createElement("div");
  escaped.textContent = text;
  const atEnd = editorTextOffset(editor, range.endContainer, range.endOffset) === editorText(editor).length;
  if (atEnd && editor.lastChild instanceof HTMLBRElement) range.setEndAfter(editor.lastChild);
  // Include the final line box in the undoable edit, not in a later DOM mutation.
  const trailingLine = atEnd && text.endsWith("\n") ? "<br>" : "";
  return document.execCommand("insertHTML", false, escaped.innerHTML + trailingLine);
}

export function insertPlainText(editor: HTMLDivElement, text: string): void {
  const selection = window.getSelection();
  const selectedRange = selection?.rangeCount ? selection.getRangeAt(0) : null;
  const range =
    selectedRange && editor.contains(selectedRange.commonAncestorContainer)
      ? selectedRange.cloneRange()
      : document.createRange();
  if (!selectedRange || !editor.contains(selectedRange.commonAncestorContainer)) {
    range.selectNodeContents(editor);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  const caretOffset = editorTextOffset(editor, range.startContainer, range.startOffset) + text.length;
  if (!insertTextThroughBrowser(editor, text)) {
    // jsdom has no editing commands. Keep the range path for that environment.
    if (!editor.textContent) editor.querySelector(":scope > br:last-child")?.remove();
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    if (editor.textContent?.endsWith("\n") && !(editor.lastChild instanceof HTMLBRElement)) {
      editor.append(document.createElement("br"));
    }
  }
  // Native deletion can put the caret before the previous newline. Restore the edit's endpoint.
  const caretRange = rangeFromTextOffsets(editor, caretOffset, caretOffset);
  if (!caretRange) return;
  selection?.removeAllRanges();
  selection?.addRange(caretRange);
}

/*
 * Continues or ends a Markdown list, as `markdownListLineBreak` describes. The edit works in the
 * editor's text offsets, where a chip counts as one position, and it changes only the current
 * line, so chips stay in place.
 */
export function insertLineBreak(editor: HTMLDivElement): void {
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (!range?.collapsed || !editor.contains(range.commonAncestorContainer)) {
    insertPlainText(editor, "\n");
    return;
  }
  const text = editorText(editor);
  const caret = editorTextOffset(editor, range.startContainer, range.startOffset);
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

function isTrailingPlaceholder(node: HTMLElement): boolean {
  return node.tagName === "BR" && !node.nextSibling;
}

export function placeCaretAtEnd(editor: HTMLDivElement): void {
  const end = editorText(editor).length;
  const range = rangeFromTextOffsets(editor, end, end);
  if (!range) return;
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

// Each tag occupies one position. Renaming a tag must not move a selection after it.
function editorSegments(root: Node): Node[] {
  return Array.from(root.childNodes).flatMap((node) => {
    if (node.nodeType === Node.TEXT_NODE) return [node];
    if (!(node instanceof HTMLElement) || isTrailingPlaceholder(node)) return [];
    if (node.contentEditable === "false" || node.tagName === "BR") return [node];
    return editorSegments(node);
  });
}

export function editorText(root: Node): string {
  return editorSegments(root)
    .map((node) =>
      node.nodeType === Node.TEXT_NODE ? (node.textContent ?? "") : node.nodeName === "BR" ? "\n" : "\uFFFC",
    )
    .join("");
}

export function editorTextOffset(editor: HTMLElement, node: Node, offset: number): number {
  const prefix = document.createRange();
  prefix.selectNodeContents(editor);
  prefix.setEnd(node, offset);
  let length = 0;
  for (const segment of editorSegments(editor)) {
    if (prefix.comparePoint(segment, 0) > 0) break;
    const size = segment.nodeType === Node.TEXT_NODE ? (segment.textContent?.length ?? 0) : 1;
    if (segment === node) return length + Math.min(offset, size);
    length += size;
  }
  return length;
}

export interface EditorSelection {
  anchor: number;
  focus: number;
}

export function readEditorSelection(editor: HTMLElement): EditorSelection | null {
  const selection = editor.ownerDocument.getSelection();
  if (
    !selection?.anchorNode ||
    !selection.focusNode ||
    !editor.contains(selection.anchorNode) ||
    !editor.contains(selection.focusNode)
  )
    return null;
  return {
    anchor: editorTextOffset(editor, selection.anchorNode, selection.anchorOffset),
    focus: editorTextOffset(editor, selection.focusNode, selection.focusOffset),
  };
}

export function restoreEditorSelection(editor: HTMLElement, saved: EditorSelection): void {
  const anchor = rangeFromTextOffsets(editor, saved.anchor, saved.anchor);
  const focus = rangeFromTextOffsets(editor, saved.focus, saved.focus);
  if (!anchor || !focus) return;
  editor.ownerDocument
    .getSelection()
    ?.setBaseAndExtent(anchor.startContainer, anchor.startOffset, focus.startContainer, focus.startOffset);
}

export function rangeFromTextOffsets(root: HTMLElement, start: number, end: number): Range | null {
  const range = document.createRange();
  const segments = editorSegments(root);
  function pointAt(position: number): { node: Node; offset: number } {
    let remaining = Math.max(0, position);
    for (const node of segments) {
      const text = node.nodeType === Node.TEXT_NODE;
      const length = text ? (node.textContent?.length ?? 0) : 1;
      if (remaining <= length) {
        if (text) return { node, offset: remaining };
        const parent = node.parentNode ?? root;
        const index = Array.from<Node>(parent.childNodes).indexOf(node);
        return { node: parent, offset: index + (remaining > 0 ? 1 : 0) };
      }
      remaining -= length;
    }
    return { node: root, offset: root.childNodes.length };
  }
  const from = pointAt(start);
  const to = pointAt(end);
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}
