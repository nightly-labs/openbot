import type { WindowFrameState } from "@openbot/contracts/ipc";
import { Button, Copy, Minus, Square, X } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, onSettled, Show } from "solid-js";
import { appPort } from "../../app-port";
import { usePlatform } from "../../platform";

const WINDOW_BUTTONS_ATTRIBUTE = "data-openbot-window-buttons";
const WINDOW_BUTTONS_HEIGHT = 38;

const [frame, setFrame] = createSignal<WindowFrameState | null>(null);

export const windowButtonsShown = () => frame()?.buttons === true;

export const windowButtonsToastOffset = (edge: number) =>
  windowButtonsShown() ? { top: edge + WINDOW_BUTTONS_HEIGHT } : {};

export function WindowButtons(): JSX.Element {
  const { t } = useText();
  const platform = usePlatform();
  onSettled(() => {
    const windowFrame = appPort().windowFrame;
    const stop = windowFrame.onState(setFrame);
    void windowFrame
      .getState()
      .then(setFrame)
      .catch(() => setFrame(null));
    return stop;
  });

  createEffect(windowButtonsShown, (shown) => {
    document.documentElement.toggleAttribute(WINDOW_BUTTONS_ATTRIBUTE, shown);
    return () => document.documentElement.removeAttribute(WINDOW_BUTTONS_ATTRIBUTE);
  });

  return (
    <Show when={frame()?.buttons ? frame() : null}>
      {(state) => (
        <div class="window-buttons" data-inactive={platform.appFocused() ? undefined : ""}>
          <Button
            variant="ghost"
            class="window-button"
            tabindex={-1}
            aria-label={t("window.minimize")}
            onClick={() => void appPort().windowFrame.minimize()}
          >
            <Minus aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            class="window-button"
            tabindex={-1}
            aria-label={state().maximized ? t("window.restore") : t("window.maximize")}
            onClick={() => void appPort().windowFrame.toggleMaximize()}
          >
            <Show when={state().maximized} fallback={<Square aria-hidden="true" />}>
              <Copy aria-hidden="true" />
            </Show>
          </Button>
          <Button
            variant="ghost"
            class="window-button window-button-close"
            tabindex={-1}
            aria-label={t("common.close")}
            onClick={() => void appPort().windowFrame.close()}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      )}
    </Show>
  );
}
