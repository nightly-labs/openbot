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
 * host, not the editor inside it. A custom element with no open shadow root is the case the search
 * cannot enter - a closed root reports `shadowRoot` as `null` - and it counts as editable rather
 * than as a plain non-editable node, so a page that hides its editor behind one keeps the key. The
 * caller sends this to the frame that has focus, which is how an editor inside an iframe is reached.
 */
export const EDITABLE_FOCUS_SCRIPT = `(() => {
  let node = document.activeElement;
  while (node && node.shadowRoot && node.shadowRoot.activeElement) node = node.shadowRoot.activeElement;
  if (!node) return false;
  if (node.isContentEditable) return true;
  if (!node.shadowRoot && node.tagName.includes("-")) return true;
  const name = node.tagName;
  return name === "INPUT" || name === "TEXTAREA" || name === "SELECT";
})()`;
