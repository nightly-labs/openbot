export function listenForEscape(close: () => (() => void) | undefined): () => void {
  const closeOnEscape = (event: KeyboardEvent) => {
    const action = close();
    if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || !action) return;
    if (document.querySelector('[role="dialog"], [role="menu"]')) return;
    event.preventDefault();
    action();
  };
  document.addEventListener("keydown", closeOnEscape);
  return () => document.removeEventListener("keydown", closeOnEscape);
}
