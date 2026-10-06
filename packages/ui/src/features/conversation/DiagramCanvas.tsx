import { Button, Minus, Plus } from "@openbot/ui";
import { prefersReducedMotion } from "@openbot/ui/utils";
import { createSignal, onSettled } from "solid-js";
import { useText } from "../../text";

interface Camera {
  x: number;
  y: number;
  scale: number;
}

const MAX_SCALE = 8;
/** One button press or key press zooms by this factor. */
const ZOOM_STEP = 1.25;
/** A double-click zooms the fitted diagram in by this factor. */
const DOUBLE_CLICK_ZOOM = 2.5;
/** How fast a pinch or Ctrl and the wheel zooms, per pixel of wheel movement. */
const WHEEL_ZOOM_RATE = 0.01;
/** An arrow key moves the diagram by this distance. */
const KEY_STEP = 48;
/** The edge of the canvas that stays clear of a fitted diagram. */
const FIT_MARGIN = 24;

/**
 * A Mermaid diagram on a canvas in the larger view: drag it, or scroll with a trackpad or the
 * wheel, to move it in any direction; pinch, or hold Ctrl or Command and scroll, to zoom around
 * the pointer; double-click to zoom in or back to the whole diagram. The keyboard works on the
 * focused canvas: arrows move, + and - zoom, 0 fits. Each move writes the image style directly,
 * and the image is sized with `width`, not scaled, so the SVG stays sharp at every zoom.
 */
export function DiagramCanvas(props: { url: string; title: string }) {
  const { t, format } = useText();
  const [zoom, setZoom] = createSignal(1);
  let viewport: HTMLDivElement | undefined;
  let image: HTMLImageElement | undefined;
  let camera: Camera = { x: 0, y: 0, scale: 1 };
  let natural = { width: 0, height: 0 };

  // Layout sizes, not `getBoundingClientRect`: the dialog grows in with a transform.
  const view = () => ({ width: viewport?.clientWidth ?? 0, height: viewport?.clientHeight ?? 0 });
  const fitScale = () => {
    const { width, height } = view();
    if (!natural.width || !natural.height) return 1;
    return Math.min((width - FIT_MARGIN * 2) / natural.width, (height - FIT_MARGIN * 2) / natural.height, 1);
  };
  /** The nearest camera inside the limits: a small diagram stays centred, a large one keeps its edges in view. */
  const settled = (from: Camera): Camera => {
    const { width, height } = view();
    const scale = Math.min(Math.max(from.scale, Math.min(fitScale(), 1)), MAX_SCALE);
    const axis = (position: number, size: number, length: number) =>
      size <= length ? (length - size) / 2 : Math.min(Math.max(position, length - size - FIT_MARGIN), FIT_MARGIN);
    return { scale, x: axis(from.x, natural.width * scale, width), y: axis(from.y, natural.height * scale, height) };
  };
  const fitted = () => settled({ x: 0, y: 0, scale: fitScale() });
  const zoomAround = (scale: number, point: { x: number; y: number }): Camera => ({
    scale,
    x: point.x - ((point.x - camera.x) * scale) / camera.scale,
    y: point.y - ((point.y - camera.y) * scale) / camera.scale,
  });
  const centre = () => ({ x: view().width / 2, y: view().height / 2 });
  const move = (next: Camera, animate: boolean) => {
    camera = settled(next);
    setZoom(camera.scale);
    if (!image) return;
    // Buttons, keys and a double-click glide to the new view; a drag, a scroll or a pinch follows at once.
    if (animate && !prefersReducedMotion()) image.dataset.settling = "";
    else delete image.dataset.settling;
    image.style.width = `${natural.width * camera.scale}px`;
    image.style.transform = `translate(${camera.x}px, ${camera.y}px)`;
  };
  const zoomBy = (factor: number, point = centre()) => move(zoomAround(camera.scale * factor, point), true);
  const local = (event: MouseEvent) => {
    const rect = viewport?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };

  onSettled(() => {
    const area = viewport;
    const picture = image;
    if (!area || !picture) return;
    let drag: { x: number; y: number; camera: Camera } | undefined;
    // The image can load before the dialog has its size, so the first fit waits for both.
    let placed = false;
    const place = () => {
      if (placed || !natural.width || !view().width) return;
      placed = true;
      move(fitted(), false);
      picture.dataset.ready = "";
    };
    const onLoad = () => {
      natural = { width: picture.naturalWidth, height: picture.naturalHeight };
      place();
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      // A trackpad pinch arrives as a wheel event with Ctrl held.
      if (event.ctrlKey || event.metaKey) {
        move(zoomAround(camera.scale * Math.exp(-event.deltaY * WHEEL_ZOOM_RATE), local(event)), false);
        return;
      }
      const sideways = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
      const down = event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY;
      move({ ...camera, x: camera.x - sideways, y: camera.y - down }, false);
    };
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      area.setPointerCapture(event.pointerId);
      drag = { ...local(event), camera };
      area.dataset.dragging = "";
    };
    const onMove = (event: PointerEvent) => {
      if (!drag) return;
      const point = local(event);
      move({ ...drag.camera, x: drag.camera.x + point.x - drag.x, y: drag.camera.y + point.y - drag.y }, false);
    };
    const onUp = () => {
      drag = undefined;
      delete area.dataset.dragging;
    };
    const onResize = new ResizeObserver(() => {
      if (placed) move(camera, false);
      else place();
    });
    picture.addEventListener("load", onLoad);
    if (picture.complete && picture.naturalWidth) onLoad();
    area.addEventListener("wheel", onWheel, { passive: false });
    area.addEventListener("pointerdown", onDown);
    area.addEventListener("pointermove", onMove);
    area.addEventListener("pointerup", onUp);
    area.addEventListener("pointercancel", onUp);
    onResize.observe(area);
    return () => {
      picture.removeEventListener("load", onLoad);
      area.removeEventListener("wheel", onWheel);
      area.removeEventListener("pointerdown", onDown);
      area.removeEventListener("pointermove", onMove);
      area.removeEventListener("pointerup", onUp);
      area.removeEventListener("pointercancel", onUp);
      onResize.disconnect();
    };
  });

  return (
    <div class="message-preview-canvas">
      <div
        ref={(element) => (viewport = element)}
        class="message-preview-canvas-viewport"
        // The canvas takes the arrow keys, so a screen reader passes them through to it.
        role="application"
        aria-label={t("chat.preview.canvasLabel", { title: props.title })}
        tabindex="0"
        onDblClick={(event: MouseEvent) => {
          if (camera.scale > fitScale() * 1.05) move(fitted(), true);
          else move(zoomAround(Math.min(fitScale() * DOUBLE_CLICK_ZOOM, MAX_SCALE), local(event)), true);
        }}
        onKeyDown={(event: KeyboardEvent) => {
          const step = {
            ArrowLeft: [KEY_STEP, 0],
            ArrowRight: [-KEY_STEP, 0],
            ArrowUp: [0, KEY_STEP],
            ArrowDown: [0, -KEY_STEP],
          }[event.key];
          if (step) move({ ...camera, x: camera.x + (step[0] ?? 0), y: camera.y + (step[1] ?? 0) }, true);
          else if (event.key === "+" || event.key === "=") zoomBy(ZOOM_STEP);
          else if (event.key === "-") zoomBy(1 / ZOOM_STEP);
          else if (event.key === "0") move(fitted(), true);
          else return;
          event.preventDefault();
        }}
      >
        <img
          ref={(element) => (image = element)}
          class="message-preview-canvas-image"
          src={props.url}
          alt={props.title}
          draggable={false}
        />
      </div>
      <div class="message-preview-zoom" role="toolbar" aria-label={t("chat.preview.zoomLabel")}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("chat.preview.zoomOut")}
          title={t("chat.preview.zoomOut")}
          onClick={() => zoomBy(1 / ZOOM_STEP)}
        >
          <Minus aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="message-preview-zoom-level"
          aria-label={t("chat.preview.zoomFit", { zoom: format.percent(zoom(), { maximumFractionDigits: 0 }) })}
          title={t("chat.preview.zoomFit", { zoom: format.percent(zoom(), { maximumFractionDigits: 0 }) })}
          onClick={() => move(fitted(), true)}
        >
          {format.percent(zoom(), { maximumFractionDigits: 0 })}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("chat.preview.zoomIn")}
          title={t("chat.preview.zoomIn")}
          onClick={() => zoomBy(ZOOM_STEP)}
        >
          <Plus aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
