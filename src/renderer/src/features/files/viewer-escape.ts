const OPEN_LAYER = '[role="dialog"], [role="alertdialog"], [role="menu"]';

/**
 * Whether this key closes the file viewer over the Library. A menu or dialog over the viewer closes on
 * Escape from a document listener that runs after the viewer's, so the viewer stays open under it.
 */
export function escapeClosesViewer(event: KeyboardEvent): boolean {
  if (event.key !== "Escape" || event.defaultPrevented) return false;
  return !(event.target instanceof Element && event.target.closest(OPEN_LAYER));
}
