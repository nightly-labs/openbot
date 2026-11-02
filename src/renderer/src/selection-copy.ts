/**
 * Copying selected page text writes clean HTML. Chromium's own HTML gives each element its computed
 * style, so a paste into a mail or a document got the theme colors (white text on a dark background)
 * and the markup of the app buttons. Here the HTML keeps only the structure: headings, lists, tables,
 * links, code and line breaks. The plain text is the selection text, as before. The message box gets
 * the same copy; its own paste reads only the plain text. A text field copies only plain text, so it
 * keeps the native copy.
 *
 * A copy that an earlier listener handled stays as it is, such as a draft with attachments or the
 * nodes of the workflow canvas. A formula is the exception: `katex/contrib/copy-tex` writes its TeX
 * plain text, and its HTML has the KaTeX classes, inline styles and each formula two times. Here the
 * HTML is replaced, with the TeX source of each formula.
 *
 * A cut in the message box gets the same clean copy, and then deletes the selection, as the native
 * cut does.
 *
 * Import this module for its effect. The listeners are on the window, so that the listeners on the
 * document and on the elements, such as `katex/contrib/copy-tex`, run first.
 */
for (const type of ["copy", "cut"] as const) window.addEventListener(type, writeSelection);

function writeSelection(event: ClipboardEvent): void {
  if (!event.clipboardData || isTextField(event.target)) return;
  const cut = event.type === "cut";
  // A cut changes only text that can be edited.
  if (cut && !isEditable(event.target)) return;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
  const handled = event.defaultPrevented;
  if (handled && !event.clipboardData.getData("text/html").includes("katex-mathml")) return;
  // As the native copy: without unselectable text, which `toString` also skips, and with no-break spaces as spaces.
  const text = selection.toString().replace(/\u00a0/gu, " ");
  if (!text) return;
  const container = document.createElement("div");
  for (let index = 0; index < selection.rangeCount; index += 1) {
    container.append(rangeFragment(selection.getRangeAt(index)));
  }
  if (!handled) event.clipboardData.setData("text/plain", text);
  event.clipboardData.setData("text/html", container.innerHTML);
  event.preventDefault();
  if (cut) document.execCommand("delete", false);
}

/**
 * A line of text whose spaces the page keeps, for HTML. HTML joins a run of spaces and a tab into one
 * space, so the leading spaces, all but the last space of a run, and each tab become no-break spaces.
 */
export function keptSpaces(line: string): string {
  return line.replace(/\t/gu, "\u00a0".repeat(4)).replace(/^ +| (?= )/gu, (spaces) => "\u00a0".repeat(spaces.length));
}

/** Tags that keep their meaning in a paste. All other elements become a `div` or only their content. */
const KEPT_TAGS = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);
/** Elements with no text to paste: controls, media and icons. */
const SKIPPED_TAGS = new Set([
  "audio",
  "canvas",
  "iframe",
  "img",
  "input",
  "noscript",
  "object",
  "script",
  "select",
  "style",
  "svg",
  "template",
  "textarea",
  "video",
]);
const EMPTY_KEPT_TAGS = new Set(["hr", "td", "th"]);
const BLOCK_DISPLAY = /^(block|flex|grid|flow-root|list-item|table|table-.+)$/u;
const PRESERVED_LINES = /^(pre|pre-wrap|pre-line|break-spaces)$/u;
const PRESERVED_SPACES = /^(pre|pre-wrap|break-spaces)$/u;
const SAFE_LINK = /^(https?|mailto):/iu;

function isTextField(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  return Boolean(element?.closest("input, textarea, select"));
}

function isEditable(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  return element instanceof HTMLElement && element.isContentEditable;
}

/** The selected part of a range, inside its kept ancestors, so text selected in a code block or a cell keeps its block. */
function rangeFragment(range: Range): Node {
  const common = range.commonAncestorContainer;
  const root = common instanceof Element ? common : common.parentElement;
  const fragment = document.createDocumentFragment();
  if (!root) return fragment;
  copyChildren(root, fragment, range, common instanceof Text ? common : null);
  let wrapped: Node = fragment;
  for (let ancestor: Element | null = root; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
    const tag = ancestor.localName;
    if (!KEPT_TAGS.has(tag)) continue;
    const element = keptElement(ancestor);
    element.append(wrapped);
    wrapped = element;
  }
  return wrapped;
}

function copyChildren(element: Element, parent: Node, range: Range, onlyText: Text | null): void {
  if (onlyText) {
    copyText(onlyText, parent, range);
    return;
  }
  for (const child of element.childNodes) {
    if (!range.intersectsNode(child)) continue;
    if (child instanceof Text) copyText(child, parent, range);
    else if (child instanceof Element) copyElement(child, parent, range);
  }
}

function copyElement(element: Element, parent: Node, range: Range): void {
  const tag = element.localName;
  if (SKIPPED_TAGS.has(tag) || element.getAttribute("aria-hidden") === "true") return;
  const style = getComputedStyle(element);
  if (style.display === "none") return;
  if (style.visibility !== "visible") {
    // A child can be visible in a hidden element. Its text stays; the hidden text does not.
    copyChildren(element, parent, range, null);
    return;
  }
  if (tag === "br") {
    parent.appendChild(document.createElement("br"));
    return;
  }
  if (element.classList.contains("katex")) {
    // The delimiters of the plain text from `katex/contrib/copy-tex`.
    const tex = element.querySelector(".katex-mathml annotation")?.textContent;
    const display = element.parentElement?.classList.contains("katex-display") === true;
    if (tex) parent.appendChild(document.createTextNode(display ? `$$${tex}$$` : `$${tex}$`));
    return;
  }
  if (!KEPT_TAGS.has(tag) && element.parentElement?.closest("pre")) {
    // The content of `pre` is text, so a line of a code block gives a line break, not a `div`.
    const line = BLOCK_DISPLAY.test(style.display) && element.parentElement.matches("pre, code");
    if (line && parent.hasChildNodes()) parent.appendChild(document.createTextNode("\n"));
    copyChildren(element, parent, range, null);
    return;
  }
  const copy = KEPT_TAGS.has(tag)
    ? keptElement(element)
    : BLOCK_DISPLAY.test(style.display)
      ? document.createElement("div")
      : null;
  copyChildren(element, copy ?? parent, range, null);
  // An empty cell stays, so that the next cells keep their columns.
  if (copy && (copy.hasChildNodes() || EMPTY_KEPT_TAGS.has(tag))) parent.appendChild(copy);
}

/** A text node, cut at the range ends. Text that the page shows on several lines keeps its breaks. */
function copyText(node: Text, parent: Node, range: Range): void {
  const owner = node.parentElement;
  if (!owner) return;
  const style = getComputedStyle(owner);
  // Text that cannot be selected, such as a button label, is not in the plain text either.
  if (style.userSelect === "none" || style.visibility !== "visible") return;
  const start = node === range.startContainer ? range.startOffset : 0;
  const end = node === range.endContainer ? range.endOffset : node.data.length;
  const value = node.data.slice(start, end);
  if (!value) return;
  if (owner.closest("pre") || !PRESERVED_LINES.test(style.whiteSpace)) {
    parent.appendChild(document.createTextNode(value));
    return;
  }
  const spaces = PRESERVED_SPACES.test(style.whiteSpace);
  value.split("\n").forEach((line, index) => {
    if (index > 0) parent.appendChild(document.createElement("br"));
    if (line) parent.appendChild(document.createTextNode(spaces ? keptSpaces(line) : line));
  });
}

/** An empty copy of a kept element, with only the attributes that a paste can use. */
function keptElement(source: Element): HTMLElement {
  const element = document.createElement(source.localName);
  const href = source.localName === "a" ? source.getAttribute("href") : null;
  if (href && SAFE_LINK.test(href)) element.setAttribute("href", href);
  for (const name of ["colspan", "rowspan", "start"]) {
    const value = source.getAttribute(name);
    if (value) element.setAttribute(name, value);
  }
  return element;
}
