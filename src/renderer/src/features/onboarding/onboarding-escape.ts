/**
 * Calls the close action when Escape is pressed on a full-window onboarding screen, and leaves the
 * key alone while the screen has no close. Returns the cleanup.
 *
 * A dialog or a menu over the screen closes on this key itself, and the screen under it stays.
 */
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
