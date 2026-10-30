import { type FileQuoteTarget, fileQuoteId } from "@openbot/contracts/chat-tag-references";
import type { AgentProfile } from "@openbot/ui/data";
import { findChatSearchMatches } from "./chat-search";
import type { SidebarFilePreview } from "./conversation-types";

const QUOTE_HIGHLIGHT = "openbot-quote-target";

let releaseHighlight: AbortController | undefined;
let stopFileQuoteWatch: (() => void) | undefined;

/** The text blocks of a sent message. A message with a table or a card has more than one. */
export function messageTextBlocks(root: ParentNode, messageId: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`[data-selection-message-id="${CSS.escape(messageId)}"]`));
}

/**
 * Marks the first place in the message where the quoted text shows, and returns it. The mark stays
 * until the next pointer press or Escape. Returns null when the message no longer has the text.
 */
export function highlightQuotedText(blocks: HTMLElement[], text: string): Range | null {
  clearQuotedTextHighlight();
  const row = blocks[0]?.closest<HTMLElement>("[data-chat-search-message]");
  if (!row?.parentElement) return null;
  const range =
    findChatSearchMatches(row.parentElement, text).find(
      (match) => match.message === row && blocks.some((block) => block.contains(match.range.startContainer)),
    )?.range ?? null;
  if (range) markQuotedRange(range, row.ownerDocument);
  return range;
}

/**
 * The quote id, with no lines, of the file that the side panel shows. The agent can read a workspace
 * file, a shared file and an attachment, so a passage of one can be quoted. A folder cannot.
 * `workspacePath` is set in a channel. A quote id names no agent, so there a workspace file is named
 * by its absolute path, which is in the workspace of one agent only.
 */
export function filePreviewQuoteId(
  file: SidebarFilePreview | null | undefined,
  workspacePath?: string | undefined,
): string | undefined {
  const source = file?.source;
  if (source?.kind === "attachment")
    return fileQuoteId({ source: "attachment", attachmentId: source.attachment.id, name: source.attachment.name });
  if (source?.kind === "workspace")
    return fileQuoteId({
      source: "workspace",
      path: workspacePath ? absoluteWorkspacePath(workspacePath, source.path) : source.path,
    });
  return source?.kind === "shared" ? fileQuoteId({ source: "shared", path: source.path }) : undefined;
}

function absoluteWorkspacePath(workspacePath: string, path: string): string {
  if (/^(?:~[/\\]|[/\\]|[A-Za-z]:[/\\])/u.test(path)) return path;
  const separator = workspacePath.includes("\\") && !workspacePath.includes("/") ? "\\" : "/";
  return `${workspacePath.replace(/[/\\]+$/u, "")}${separator}${path.replace(/^\.[/\\]/u, "")}`;
}

/** The agent whose workspace holds an absolute path. A workspace inside another one wins. */
export function workspaceAgentOfPath(agents: readonly AgentProfile[], path: string): string | undefined {
  let found: { id: string; root: string } | undefined;
  for (const agent of agents) {
    const root = agent.workspacePath?.replace(/[/\\]+$/u, "");
    if (!root || !(path.startsWith(`${root}/`) || path.startsWith(`${root}\\`))) continue;
    if (!found || root.length > found.root.length) found = { id: agent.id, root };
  }
  return found?.id;
}

/**
 * Marks a quoted passage of a file when the side panel shows the file, and scrolls to it. The file
 * loads after the request, and the code highlighter replaces its text after that, so this marks the
 * passage again each time its text changes. It stops at the next pointer press or Escape.
 */
export function revealFileQuote(document: Document, file: FileQuoteTarget, text: string): void {
  stopFileQuoteWatch?.();
  clearQuotedTextHighlight();
  const selector = `[data-selection-file-quote="${CSS.escape(fileQuoteId({ ...file, lines: undefined }))}"]`;
  let marked: Range | null = null;
  let searched: HTMLElement | null = null;
  // Other parts of the app change all the time, so the file text is searched again only when it changes.
  const show = (records: MutationRecord[] = []) => {
    // A replaced text node collapses the range.
    if (marked && !marked.collapsed) return;
    const block = document.querySelector<HTMLElement>(selector);
    if (!block || (block === searched && !records.some((record) => block.contains(record.target)))) return;
    searched = block;
    const range = fileQuoteRange(block, text, file.lines);
    if (!range) return;
    clearQuotedTextHighlight();
    markQuotedRange(range, document);
    if (!marked)
      range.startContainer.parentElement?.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
    marked = range;
  };
  const observer = new MutationObserver(show);
  const release = new AbortController();
  const stop = () => {
    observer.disconnect();
    release.abort();
    if (stopFileQuoteWatch === stop) stopFileQuoteWatch = undefined;
  };
  stopFileQuoteWatch = stop;
  show();
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  listenForRelease(document, release.signal, stop);
}

export function stopRevealingFileQuote(): void {
  stopFileQuoteWatch?.();
}

/**
 * The passage in the shown text of a file. Whitespace is not compared: rendered Markdown joins its
 * blocks without the line breaks that a selection of them has. A passage of Markdown source shows as
 * rendered text when the file opens again, so then only letters and digits are compared. Source text
 * starts at the quoted lines.
 */
function fileQuoteRange(block: HTMLElement, text: string, lines: FileQuoteTarget["lines"]): Range | null {
  const lineStart =
    lines && block.dataset.selectionFileLines === "true" ? sourceLineOffset(block.textContent ?? "", lines.start) : 0;
  for (const kept of [/\S/u, /[\p{L}\p{N}]/u]) {
    const range = compactTextRange(block, text, kept, lineStart);
    if (range) return range;
  }
  return null;
}

function compactTextRange(block: HTMLElement, text: string, kept: RegExp, lineStart: number): Range | null {
  const wanted = Array.from(text)
    .filter((character) => kept.test(character))
    .join("");
  if (!wanted) return null;
  const nodes: Text[] = [];
  const positions: Array<{ node: number; offset: number; source: number }> = [];
  let compact = "";
  let source = 0;
  const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node instanceof Text)) continue;
    const value = node.data;
    nodes.push(node);
    for (let offset = 0; offset < value.length; offset += 1) {
      const character = value[offset] ?? "";
      if (kept.test(character)) {
        compact += character;
        positions.push({ node: nodes.length - 1, offset, source: source + offset });
      }
    }
    source += value.length;
  }
  const from = Math.max(
    0,
    positions.findIndex((position) => position.source >= lineStart),
  );
  const atLines = compact.indexOf(wanted, from);
  const index = atLines >= 0 ? atLines : compact.indexOf(wanted);
  const first = positions[index];
  const last = positions[index + wanted.length - 1];
  const startNode = first ? nodes[first.node] : undefined;
  const endNode = last ? nodes[last.node] : undefined;
  if (index < 0 || !first || !last || !startNode || !endNode) return null;
  const range = block.ownerDocument.createRange();
  range.setStart(startNode, first.offset);
  range.setEnd(endNode, last.offset + 1);
  return range;
}

function sourceLineOffset(source: string, line: number): number {
  let offset = 0;
  for (let current = 1; current < line; current += 1) {
    const next = source.indexOf("\n", offset);
    if (next < 0) return source.length;
    offset = next + 1;
  }
  return offset;
}

function markQuotedRange(range: Range, document: Document): void {
  const registry = globalThis.CSS?.highlights;
  if (!registry) return;
  registry.set(QUOTE_HIGHLIGHT, new Highlight(range));
  releaseHighlight = new AbortController();
  listenForRelease(document, releaseHighlight.signal, clearQuotedTextHighlight);
}

function listenForRelease(document: Document, signal: AbortSignal, release: () => void): void {
  const view = document.defaultView;
  view?.addEventListener("pointerdown", release, { signal });
  view?.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") release();
    },
    { signal },
  );
}

export function clearQuotedTextHighlight(): void {
  releaseHighlight?.abort();
  releaseHighlight = undefined;
  globalThis.CSS?.highlights?.delete(QUOTE_HIGHLIGHT);
}
