/**
 * Escape closes a window page, as it closed the settings dialog. On the document and after the
 * delegated handlers, so a control that handles Escape keeps it. A click can put the focus back on
 * the rail or the server menu, so a target outside the page also counts, except an open popup or a
 * text field. Returns the function that removes the listener.
 */
export function listenForPageEscape(root: HTMLElement, onEscape: () => void): () => void {
  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[role=dialog], [role=alertdialog], [role=menu], [role=listbox]")) return;
    if (target && !root.contains(target) && target.closest("input, textarea, select, [contenteditable]")) return;
    event.preventDefault();
    onEscape();
  };
  document.addEventListener("keydown", closeOnEscape);
  return () => document.removeEventListener("keydown", closeOnEscape);
}
