import { Copy, IconButton, Minus, Square, X } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

export interface WindowControlsProps {
  maximized: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
  ref?: ((element: HTMLFieldSetElement) => void) | undefined;
}

/** Minimize, maximize or restore, and close, for a window with no system title bar (Windows). */
export function WindowControls(props: WindowControlsProps): JSX.Element {
  const { t } = useText();
  return (
    <fieldset ref={props.ref} class="window-controls" aria-label={t("window.controls.label")}>
      <IconButton variant="ghost" label={t("window.controls.minimize")} onClick={() => props.onMinimize()}>
        <Minus />
      </IconButton>
      <IconButton
        variant="ghost"
        label={t(props.maximized ? "window.controls.restore" : "window.controls.maximize")}
        onClick={() => props.onToggleMaximize()}
      >
        <Show when={props.maximized} fallback={<Square class="window-controls-box" />}>
          <Copy class="window-controls-box" />
        </Show>
      </IconButton>
      <IconButton variant="ghost" label={t("window.controls.close")} onClick={() => props.onClose()}>
        <X class="window-controls-cross" />
      </IconButton>
    </fieldset>
  );
}
