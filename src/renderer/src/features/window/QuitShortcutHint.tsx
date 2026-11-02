import { useText } from "@openbot/ui/text";
import { createSignal, onSettled, Show } from "solid-js";
import { appPort } from "../../app-port";

/**
 * On a Mac, one press of `Cmd + Q` does not quit. Main reads the key before the page does and tells
 * this window when to show how to quit: hold the keys, or press them twice.
 */
export function QuitShortcutHint() {
  const { t } = useText();
  const [shown, setShown] = createSignal(false);
  onSettled(() => appPort().onQuitShortcutHint((visible) => setShown(visible)));
  return (
    <Show when={shown()}>
      <div class="quit-shortcut-backdrop">
        <div class="quit-shortcut-hint" role="status">
          {t("menu.quitHint")}
        </div>
      </div>
    </Show>
  );
}
