/** Cmd+K on macOS and Ctrl+K elsewhere, without Alt or Shift, opens and closes the global search. */
export function isGlobalSearchShortcut(event: KeyboardEvent): boolean {
  return event.key.toLocaleLowerCase() === "k" && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
}
