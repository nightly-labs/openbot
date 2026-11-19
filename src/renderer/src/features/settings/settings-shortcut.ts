interface SettingsShortcutKey {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

export function isOpenSettingsShortcut(event: SettingsShortcutKey): boolean {
  return event.key === "," && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
}
