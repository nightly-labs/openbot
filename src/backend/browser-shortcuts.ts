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
