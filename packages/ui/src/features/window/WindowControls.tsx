import { Copy, IconButton, Minus, Square, X } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

/** What the window buttons show and do. */
export interface WindowControlsProps {
  /** The maximize button then restores the window. */
  maximized: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
  /** The group, so that the app can keep the top rows clear of it. */
  ref?: ((element: HTMLFieldSetElement) => void) | undefined;
}

/**
 * Minimize, maximize or restore, and close, for a window that has no system title bar (Windows).
 * The group stays at the top inline-end corner of the window, above the page, as system buttons do,
 * and has the icon buttons of the top row.
 */
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
