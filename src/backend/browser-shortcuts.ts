interface BrowserShortcutInput {
  type: string;
  key: string;
  control: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

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

export function isBrowserViewShortcut(input: BrowserShortcutInput, mac: boolean): boolean {
  if (input.type !== "keyDown") return false;
  const key = input.key.toLowerCase();
  if (input.control && !input.meta && !input.alt && key === "tab") return true;
  if (input.control && input.shift && !input.meta && !input.alt && (key === "pageup" || key === "pagedown")) {
    return true;
  }
  const mod = mac ? input.meta && !input.control : input.control && !input.meta;
  if (!mod) return false;
  if (input.alt) return mac && !input.shift && (key === "arrowleft" || key === "arrowright");
  if (key === "t") return true;
  return !input.shift && (["w", "l", "r", "[", "]"].includes(key) || /^[1-9]$/.test(key));
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

export type ChatEditAction = "undo" | "redo" | "cut" | "copy" | "paste" | "pasteAndMatchStyle" | "delete" | "selectAll";

export type ChatContextMenuItem =
  | { kind: "copy-link" }
  | { kind: "copy-image" }
  | { kind: "separator" }
  | { kind: "spelling"; suggestion: string }
  | { kind: "edit"; action: ChatEditAction; enabled: boolean };

export interface ChatContextMenuParams {
  selectionText: string;
  isEditable: boolean;
  linkURL: string;
  mediaType: string;
  hasImageContents: boolean;
  misspelledWord: string;
  dictionarySuggestions: string[];
  editFlags: {
    canUndo: boolean;
    canRedo: boolean;
    canCut: boolean;
    canCopy: boolean;
    canPaste: boolean;
    canDelete: boolean;
    canSelectAll: boolean;
  };
  pasteAndMatchStyle: boolean;
}

export function chatContextMenuItems(params: ChatContextMenuParams): ChatContextMenuItem[] {
  const items: ChatContextMenuItem[] = [];
  const separate = () => {
    if (items.length > 0) items.push({ kind: "separator" });
  };
  const edit = (action: ChatEditAction, enabled: boolean) => items.push({ kind: "edit", action, enabled });
  if (params.linkURL) items.push({ kind: "copy-link" });
  if (params.mediaType === "image" && params.hasImageContents) items.push({ kind: "copy-image" });
  const flags = params.editFlags;
  if (params.isEditable) {
    if (params.misspelledWord && params.dictionarySuggestions.length > 0) {
      separate();
      for (const suggestion of params.dictionarySuggestions) items.push({ kind: "spelling", suggestion });
    }
    separate();
    edit("undo", flags.canUndo);
    edit("redo", flags.canRedo);
    separate();
    edit("cut", flags.canCut);
    edit("copy", flags.canCopy);
    edit("paste", flags.canPaste);
    if (params.pasteAndMatchStyle) edit("pasteAndMatchStyle", flags.canPaste);
    edit("delete", flags.canDelete);
    separate();
    edit("selectAll", flags.canSelectAll);
    return items;
  }
  if (params.selectionText.trim().length === 0) return items;
  separate();
  edit("copy", true);
  edit("selectAll", true);
  return items;
}

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
