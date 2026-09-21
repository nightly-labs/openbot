interface BrowserShortcutInput {
  type: string;
  key: string;
  control: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

/**
 * A bare Escape, which collapses the expanded browser back to the preview sidebar. The expanded
 * panel covers the whole window, so the page holds focus almost all the time and the renderer
 * never sees the key unless the host forwards it.
 */
export function isCollapseBrowserShortcut(input: BrowserShortcutInput): boolean {
  return (
    input.type === "keyDown" && input.key === "Escape" && !input.control && !input.meta && !input.alt && !input.shift
  );
}

export function isCloseBrowserTabShortcut(input: BrowserShortcutInput): boolean {
  return (
    input.type === "keyDown" &&
    input.key.toLowerCase() === "w" &&
    (input.control || input.meta) &&
    !input.alt &&
    !input.shift
  );
}

export function isGlobalSearchShortcut(input: BrowserShortcutInput): boolean {
  return (
    input.type === "keyDown" &&
    input.key.toLowerCase() === "k" &&
    (input.control || input.meta) &&
    !input.alt &&
    !input.shift
  );
}

export function isSelectAllShortcut(input: BrowserShortcutInput): boolean {
  return (
    input.type === "keyDown" &&
    input.key.toLowerCase() === "a" &&
    (input.control || input.meta) &&
    !input.alt &&
    !input.shift
  );
}

export function isToggleDevToolsShortcut(input: BrowserShortcutInput): boolean {
  if (input.type !== "keyDown") return false;
  const key = input.key.toLowerCase();
  if (key === "f12") return !input.control && !input.meta && !input.alt && !input.shift;
  return key === "i" && (input.control || input.meta) && input.alt !== input.shift;
}

export type ChatContextMenuItem = "copy-link" | "separator" | "copy" | "select-all";

export interface ChatContextMenuParams {
  selectionText: string;
  isEditable: boolean;
  linkURL: string;
}

/**
 * The native items a right-click offers in chat. Selected text and editable fields get the edit
 * roles, a link gets a copy-link entry first; anywhere else keeps no menu, so the window does not
 * pop a menu with nothing useful in it.
 */
export function chatContextMenuItems(params: ChatContextMenuParams): ChatContextMenuItem[] {
  const items: ChatContextMenuItem[] = [];
  if (params.linkURL) items.push("copy-link");
  const hasSelection = params.selectionText.trim().length > 0;
  if (!hasSelection && !params.isEditable) return items;
  if (items.length > 0) items.push("separator");
  if (hasSelection) items.push("copy");
  items.push("select-all");
  return items;
}

/**
 * Asked of an embedded page before Escape is taken away from it: does the focus hold text the user
 * is in the middle of typing? The answer decides whether Escape collapses the expanded browser or
 * stays with the page, so it errs towards the page. Focus can sit anywhere: the search starts at the
 * top document and follows open shadow roots inward, because `activeElement` at each level is the
 * host, not the editor inside it. The caller sends this to the frame that has focus, which is how an
 * editor inside an iframe is reached.
 *
 * A closed shadow root is the case the search cannot enter: it reports `shadowRoot` as `null`, so an
 * editor inside one is indistinguishable from an ordinary node. The page can only be hiding one when
 * the focus is an element that is allowed to host a shadow root, which is a custom element or one of
 * the names below, so those count as editing rather than as a plain non-editable node. The cost is
 * that Escape leaves a focused `div` with the page; the hide button still collapses the panel, while
 * the other way round loses what the user typed. `BODY` and `HTML` are left out although `body` is a
 * legal host: `document.activeElement` is the body whenever nothing at all has focus, which is the
 * common case Escape exists for.
 */
const SHADOW_HOST_NAMES = new Set([
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DIV",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "MAIN",
  "NAV",
  "P",
  "SECTION",
  "SPAN",
]);

export const EDITABLE_FOCUS_SCRIPT = `(() => {
  const hosts = new Set(${JSON.stringify([...SHADOW_HOST_NAMES])});
  let node = document.activeElement;
  while (node && node.shadowRoot && node.shadowRoot.activeElement) node = node.shadowRoot.activeElement;
  if (!node) return false;
  if (node.isContentEditable) return true;
  const name = node.tagName;
  if (name === "INPUT" || name === "TEXTAREA" || name === "SELECT") return true;
  return !node.shadowRoot && (name.includes("-") || hosts.has(name));
})()`;

export type BrowserContextMenuItem =
  | "copy-link"
  | "copy-image-address"
  | "separator"
  | "cut"
  | "copy"
  | "paste"
  | "select-all";

export interface BrowserContextMenuParams {
  selectionText: string;
  isEditable: boolean;
  linkURL: string;
  srcURL: string;
  mediaType: string;
}

/**
 * The native items a right-click offers on an embedded page. Electron draws no menu of its own for
 * a `WebContentsView`, so without this a page offers no way at all to copy what it shows, and a
 * "copy link" the page draws itself is the only route to a URL the label truncates.
 *
 * `linkURL` and `srcURL` are the resolved targets Chromium reports, not the rendered label, so the
 * copy items give the whole URL. The edit items come from the same reading as the chat menu, plus
 * cut and paste, because an embedded page has real form fields the chat does not.
 */
export function browserContextMenuItems(params: BrowserContextMenuParams): BrowserContextMenuItem[] {
  const items: BrowserContextMenuItem[] = [];
  if (params.linkURL) items.push("copy-link");
  if (params.srcURL && params.mediaType === "image") items.push("copy-image-address");
  const hasSelection = params.selectionText.trim().length > 0;
  if (!hasSelection && !params.isEditable) return items;
  if (items.length > 0) items.push("separator");
  if (hasSelection && params.isEditable) items.push("cut");
  if (hasSelection) items.push("copy");
  if (params.isEditable) items.push("paste");
  items.push("select-all");
  return items;
}
