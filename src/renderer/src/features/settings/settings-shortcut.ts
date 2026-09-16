interface SettingsShortcutKey {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/**
 * The Settings shortcut: `Cmd + ,` on macOS, `Ctrl + ,` elsewhere. It fires from any focused
 * control, including a text field, because the native Preferences item it mirrors does the same.
 */
export function isOpenSettingsShortcut(event: SettingsShortcutKey): boolean {
  return event.key === "," && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
}
