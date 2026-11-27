const OPEN_LAYER = '[role="dialog"], [role="alertdialog"], [role="menu"]';

export function escapeClosesViewer(event: KeyboardEvent): boolean {
  if (event.key !== "Escape" || event.defaultPrevented) return false;
  return !(event.target instanceof Element && event.target.closest(OPEN_LAYER));
}
