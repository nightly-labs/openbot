/** The zoom bar of the canvas: zoom out, the zoom menu, zoom in, zoom to fit, and the minimap. */

import type { AppTextKey } from "@openbot/i18n";
import { buttonVariants, DropdownMenu, Kbd, MapIcon, Minus, Plus, Scan } from "@openbot/ui";
import { For } from "solid-js";
import { useText } from "../../text";
import { HudButton, hudBarRect } from "./WorkflowCanvasHud";
import { MOD_KEY } from "./workflow-board";

/** The zoom levels in the grid of the zoom menu, as on the Higgsfield canvas. */
const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2];

type ZoomAction = "in" | "out" | "reset" | "fit";

const ZOOM_LABEL = {
  in: "workflow.canvas.zoom.in",
  out: "workflow.canvas.zoom.out",
  reset: "workflow.canvas.zoom.reset",
  fit: "workflow.canvas.zoom.fit",
} satisfies Record<ZoomAction, AppTextKey>;

/** The shortcut of each zoom action. */
export const ZOOM_KEYS: Record<ZoomAction, readonly string[]> = {
  in: [MOD_KEY, "+"],
  out: [MOD_KEY, "−"],
  reset: [MOD_KEY, "0"],
  fit: ["⇧", "1"],
};

export function WorkflowZoomMenu(props: {
  scale: number;
  minScale: number;
  maxScale: number;
  minimap: boolean;
  onZoom: (action: ZoomAction) => void;
  onZoomTo: (scale: number) => void;
  onToggleMinimap: () => void;
}) {
  const { t, format } = useText();
  const percent = () => Math.round(props.scale * 100);
  const actions: readonly ZoomAction[] = ["in", "out", "reset", "fit"];
  return (
    <div class="wfn-hud wfn-hud-zoom">
      <HudButton
        label={t(ZOOM_LABEL.out)}
        keys={ZOOM_KEYS.out}
        disabled={props.scale <= props.minScale}
        onClick={() => props.onZoom("out")}
      >
        <Minus />
      </HudButton>
      <DropdownMenu.Root placement="top-start" gutter={8} getAnchorRect={hudBarRect} modal={false}>
        <DropdownMenu.Trigger
          class={`${buttonVariants({ variant: "ghost", size: "sm" })} wfn-hud-button wfn-zoom-value`}
          aria-label={t("workflow.canvas.zoom.value", { percent: format.percent(percent() / 100) })}
        >
          {format.percent(percent() / 100)}
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            class="wfn-menu wfn-zoom-menu"
            data-wfn-portal=""
            aria-label={t("workflow.canvas.zoom.menu")}
          >
            <div class="wfn-zoom-presets">
              <For each={ZOOM_PRESETS}>
                {(level) => (
                  <DropdownMenu.Item
                    class="wfn-zoom-preset"
                    data-current={percent() === level * 100 ? "" : undefined}
                    onSelect={() => props.onZoomTo(level)}
                  >
                    {format.percent(level)}
                  </DropdownMenu.Item>
                )}
              </For>
            </div>
            <DropdownMenu.Separator />
            <For each={actions}>
              {(action) => (
                <DropdownMenu.Item onSelect={() => props.onZoom(action)}>
                  <span class="wfn-menu-text">{t(ZOOM_LABEL[action])}</span>
                  <span class="wfn-keys" aria-hidden="true">
                    <For each={ZOOM_KEYS[action]}>{(key) => <Kbd>{key}</Kbd>}</For>
                  </span>
                </DropdownMenu.Item>
              )}
            </For>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <HudButton
        label={t(ZOOM_LABEL.in)}
        keys={ZOOM_KEYS.in}
        disabled={props.scale >= props.maxScale}
        onClick={() => props.onZoom("in")}
      >
        <Plus />
      </HudButton>
      <span class="wfn-hud-separator" aria-hidden="true" />
      <HudButton label={t(ZOOM_LABEL.fit)} keys={ZOOM_KEYS.fit} onClick={() => props.onZoom("fit")}>
        <Scan />
      </HudButton>
      <HudButton
        label={props.minimap ? t("workflow.canvas.minimap.close") : t("workflow.canvas.minimap.open")}
        pressed={props.minimap}
        onClick={props.onToggleMinimap}
      >
        <MapIcon />
      </HudButton>
    </div>
  );
}
