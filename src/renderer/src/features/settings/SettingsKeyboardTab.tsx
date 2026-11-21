import { KeyboardShortcutsSettings } from "@openbot/ui/features/settings/KeyboardShortcutsSettings";
import type { JSX } from "@solidjs/web";
import {
  resetShortcuts,
  setShortcut,
  shortcutEnvironment,
  useShortcutOverrides,
} from "../../keyboard-shortcut-preference";
import { useKeyLayout } from "../conversation/voice-talk-key";

export function SettingsKeyboardTab(): JSX.Element {
  const overrides = useShortcutOverrides();
  const layout = useKeyLayout();
  return (
    <KeyboardShortcutsSettings
      environment={shortcutEnvironment()}
      overrides={overrides()}
      layout={layout()}
      onChange={setShortcut}
      onResetAll={resetShortcuts}
    />
  );
}
