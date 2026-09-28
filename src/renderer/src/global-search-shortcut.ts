/**
 * Cmd+K on macOS and Ctrl+K elsewhere, without Alt or Shift, opens and closes the global search. A
 * browser autofill sends a keydown with no `key`, so the key is read with care.
 */
export function isGlobalSearchShortcut(event: KeyboardEvent): boolean {
  return event.key?.toLocaleLowerCase() === "k" && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
}
