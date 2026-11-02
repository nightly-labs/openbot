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

/**
 * A key of the full browser view, as other browsers have them: new, reopen, close and select tab,
 * address, reload, back and forward. The page has the focus nearly all the time, so the host sends
 * these keys on to the window, where the view acts on them. `browser-view-shortcuts.ts` in
 * `@openbot/ui` reads the same keys.
 */
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

/** The edit commands of the chat menu, each named after the `WebContents` method that runs it. */
export type ChatEditAction = "undo" | "redo" | "cut" | "copy" | "paste" | "pasteAndMatchStyle" | "delete" | "selectAll";

export type ChatContextMenuItem =
  | { kind: "copy-link" }
  | { kind: "separator" }
  | { kind: "spelling"; suggestion: string }
  | { kind: "edit"; action: ChatEditAction; enabled: boolean };

export interface ChatContextMenuParams {
  selectionText: string;
  isEditable: boolean;
  linkURL: string;
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
  /** macOS is the only platform with a Paste and Match Style command. */
  pasteAndMatchStyle: boolean;
}

/**
 * The native items a right-click offers in chat. An editable field gets spelling suggestions and
 * the full edit menu, each entry enabled from the field's edit state. Selected text elsewhere gets
 * copy and select-all, and a link gets a copy-link entry first. Anywhere else keeps no menu, so the
 * window does not pop a menu with nothing useful in it.
 */
export function chatContextMenuItems(params: ChatContextMenuParams): ChatContextMenuItem[] {
  const items: ChatContextMenuItem[] = [];
  const separate = () => {
    if (items.length > 0) items.push({ kind: "separator" });
  };
  const edit = (action: ChatEditAction, enabled: boolean) => items.push({ kind: "edit", action, enabled });
  if (params.linkURL) items.push({ kind: "copy-link" });
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
