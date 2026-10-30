import { Button, Minus, Plus } from "@openbot/ui";
import { useText } from "../../text";

/** The view of a zoomed image: its scale and its offset. */
export interface Camera {
  x: number;
  y: number;
  scale: number;
}

/** The closest zoom shows each pixel of the image this many times larger. */
export const MAX_SCALE = 8;
/** One button press or key press zooms by this factor. */
export const ZOOM_STEP = 1.25;
/** A double-click zooms the fitted image in by this factor. */
export const DOUBLE_CLICK_ZOOM = 2.5;
/** How fast a pinch or Ctrl and the wheel zooms, per pixel of wheel movement. */
export const WHEEL_ZOOM_RATE = 0.01;

/** Zoom out, the zoom level, which fits the view when pressed, and zoom in. */
export function ZoomControls(props: {
  class: string;
  levelClass: string;
  buttonClass?: string;
  /** The zoom level, as a part of the natural size. */
  zoom: number;
  onZoomOut: () => void;
  onFit: () => void;
  onZoomIn: () => void;
}) {
  const { t, format } = useText();
  const level = () => format.percent(props.zoom, { maximumFractionDigits: 0 });
  return (
    <div class={props.class} role="toolbar" aria-label={t("chat.preview.zoomLabel")}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        class={props.buttonClass}
        aria-label={t("chat.preview.zoomOut")}
        title={t("chat.preview.zoomOut")}
        onClick={() => props.onZoomOut()}
      >
        <Minus aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class={[props.buttonClass, props.levelClass]}
        aria-label={t("chat.preview.zoomFit", { zoom: level() })}
        title={t("chat.preview.zoomFit", { zoom: level() })}
        onClick={() => props.onFit()}
      >
        {level()}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        class={props.buttonClass}
        aria-label={t("chat.preview.zoomIn")}
        title={t("chat.preview.zoomIn")}
        onClick={() => props.onZoomIn()}
      >
        <Plus aria-hidden="true" />
      </Button>
    </div>
  );
}
