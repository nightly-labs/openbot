for (const type of ["copy", "cut"] as const) window.addEventListener(type, writeSelection);

function writeSelection(event: ClipboardEvent): void {
  if (!event.clipboardData || isTextField(event.target)) return;
  const cut = event.type === "cut";
  if (cut && !isEditable(event.target)) return;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
  const handled = event.defaultPrevented;
  if (handled && !event.clipboardData.getData("text/html").includes("katex-mathml")) return;
  const native = selection.toString().replace(/\u00a0/gu, " ");
  const text = isEditable(event.target) ? native : native.replace(/^\s*\n|\n\s*$/gu, "");
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

export function keptSpaces(line: string): string {
  return line.replace(/\t/gu, "\u00a0".repeat(4)).replace(/^ +| (?= )/gu, (spaces) => "\u00a0".repeat(spaces.length));
}

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
    copyChildren(element, parent, range, null);
    return;
  }
  if (tag === "br") {
    parent.appendChild(document.createElement("br"));
    return;
  }
  if (element.classList.contains("katex")) {
    const tex = element.querySelector(".katex-mathml annotation")?.textContent;
    const display = element.parentElement?.classList.contains("katex-display") === true;
    if (tex) parent.appendChild(document.createTextNode(display ? `$$${tex}$$` : `$${tex}$`));
    return;
  }
  if (!KEPT_TAGS.has(tag) && element.parentElement?.closest("pre")) {
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
  if (copy && (copy.hasChildNodes() || EMPTY_KEPT_TAGS.has(tag))) parent.appendChild(copy);
}

function copyText(node: Text, parent: Node, range: Range): void {
  const owner = node.parentElement;
  if (!owner) return;
  const style = getComputedStyle(owner);
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
