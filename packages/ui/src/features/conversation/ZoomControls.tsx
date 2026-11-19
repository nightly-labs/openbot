import { Button, Minus, Plus } from "@openbot/ui";
import { useText } from "../../text";

export interface Camera {
  x: number;
  y: number;
  scale: number;
}

export const MAX_SCALE = 8;
export const ZOOM_STEP = 1.25;
export const DOUBLE_CLICK_ZOOM = 2.5;
export const WHEEL_ZOOM_RATE = 0.01;

export function ZoomControls(props: {
  class: string;
  levelClass: string;
  buttonClass?: string;
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
