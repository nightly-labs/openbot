import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { Button, ChevronLeft, ChevronRight, Dialog, Spinner, X } from "@openbot/ui";
import { prefersReducedMotion } from "@openbot/ui/utils";
import { createMemo, createSignal, createStore, For, onCleanup, onSettled, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { CloseIcon, DownloadIcon } from "./ConversationIcons";
import { justifiedGalleryLayout } from "./image-gallery-layout";
import {
  BACKDROP_IN,
  BACKDROP_OUT,
  createTileMotion,
  IMAGE_FADE_IN,
  IMAGE_FADE_OUT,
  IMAGE_FADE_OUT_KEYFRAMES,
  SLIDE,
  TILE_HIDE_DURATION,
  ZOOM_IN,
  ZOOM_OUT,
  ZOOM_OUT_DURATION,
} from "./lightbox-motion";
import { type Camera, DOUBLE_CLICK_ZOOM, MAX_SCALE, WHEEL_ZOOM_RATE, ZOOM_STEP, ZoomControls } from "./ZoomControls";

/** The images that the viewer steps through, the one it opens on, and the thumbnail it grows from. */
export interface ImageLightboxOpening {
  images: AttachmentSummary[];
  index: number;
  origin?: HTMLElement | undefined;
}

export function isLightboxImage(attachment: AttachmentSummary): boolean {
  return attachment.previewKind === "image" && Boolean(attachment.previewUrl);
}

const GALLERY_ROW_HEIGHT = 160;
const GALLERY_MAX_ROW_HEIGHT = 240;
const GALLERY_GAP = 6;
/* A panorama or a tall screenshot would otherwise take a whole row or a sliver of one. */
const GALLERY_MIN_RATIO = 0.5;
const GALLERY_MAX_RATIO = 3;
const SWIPE_DISTANCE = 48;
/** A drag of a zoomed image that moves this far is not a click, so it does not close the viewer. */
const DRAG_DISTANCE = 4;

/** The zoom of the shown image: its scale over the fitted size and its offset from the centre. */
const FIT: Camera = { x: 0, y: 0, scale: 1 };

interface Point {
  x: number;
  y: number;
}

/** Several images of one message, laid out in justified rows. */
export function ImageGallery(props: {
  images: AttachmentSummary[];
  onOpen: (attachment: AttachmentSummary, origin: HTMLElement) => void;
  /** A tile whose preview fails downloads the file, so the file stays reachable. */
  onDownload?: ((attachment: AttachmentSummary) => void) | undefined;
}) {
  const { t } = useText();
  const [ratios, setRatios] = createStore<Record<string, number>>({});
  const [missing, setMissing] = createStore<Record<string, boolean>>({});
  const [loaded, setLoaded] = createStore<Record<string, boolean>>({});
  const [width, setWidth] = createSignal(0);
  let gallery: HTMLUListElement | undefined;
  const layout = createMemo(() =>
    justifiedGalleryLayout(
      props.images.map((image) => ratios[image.id] ?? 1),
      {
        width: width(),
        rowHeight: GALLERY_ROW_HEIGHT,
        maxRowHeight: GALLERY_MAX_ROW_HEIGHT,
        gap: GALLERY_GAP,
        minPerRow: 2,
      },
    ),
  );

  onSettled(() => {
    if (!gallery) return;
    const element = gallery;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  });

  return (
    <ul
      ref={(element) => (gallery = element)}
      class="image-gallery"
      aria-label={t("chat.image.gallery", { count: props.images.length })}
      style={{ height: `${layout().height}px` }}
    >
      <For each={props.images}>
        {(image, index) => {
          const box = () => layout().boxes[index()];
          // Keyed by URL: a new URL for the same attachment gets a new try.
          const key = () => image.previewUrl ?? image.id;
          const isMissing = () => missing[key()] === true;
          return (
            <li
              class="image-gallery-item"
              style={{
                left: `${box()?.left ?? 0}px`,
                top: `${box()?.top ?? 0}px`,
                width: `${box()?.width ?? 0}px`,
                height: `${box()?.height ?? 0}px`,
              }}
            >
              <Button
                variant="ghost"
                type="button"
                class={["image-gallery-tile", { "image-gallery-tile-missing": isMissing() }]}
                data-attachment-id={image.id}
                disabled={isMissing() && !props.onDownload}
                data-cuelume-tap={isMissing() ? undefined : "open"}
                aria-label={
                  !isMissing()
                    ? t("chat.image.preview", { name: image.name })
                    : props.onDownload
                      ? t("chat.image.download", { name: image.name })
                      : t("chat.image.unavailable")
                }
                onClick={(event) => {
                  if (!isMissing()) props.onOpen(image, event.currentTarget);
                  else props.onDownload?.(image);
                }}
              >
                <Show when={!isMissing()} fallback={props.onDownload ? <DownloadIcon /> : <X aria-hidden="true" />}>
                  <Show when={!loaded[key()]}>
                    <span class="image-gallery-tile-loading">
                      <Spinner />
                    </span>
                  </Show>
                  <img
                    src={image.previewUrl ?? ""}
                    alt=""
                    decoding="async"
                    draggable={false}
                    onLoad={(event) => {
                      setLoaded((state) => {
                        state[key()] = true;
                      });
                      const { naturalHeight, naturalWidth } = event.currentTarget;
                      if (naturalWidth <= 0 || naturalHeight <= 0) return;
                      const ratio = Math.min(
                        GALLERY_MAX_RATIO,
                        Math.max(GALLERY_MIN_RATIO, naturalWidth / naturalHeight),
                      );
                      setRatios((state) => {
                        state[image.id] = ratio;
                      });
                    }}
                    onError={() =>
                      setMissing((state) => {
                        state[key()] = true;
                      })
                    }
                  />
                </Show>
              </Button>
            </li>
          );
        }}
      </For>
    </ul>
  );
}

/** The thumbnail's box, when enough of it is on screen to zoom from or back into. */
function visibleRect(element: HTMLElement | undefined): DOMRect | undefined {
  if (!element?.isConnected) return undefined;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return undefined;
  if (rect.bottom < 0 || rect.right < 0 || rect.top > window.innerHeight || rect.left > window.innerWidth) {
    return undefined;
  }
  return rect;
}

/** The thumbnail button can clip through its own corners or through its frame's. */
function cornerRadius(element: HTMLElement | undefined): number {
  for (const node of [element, element?.parentElement]) {
    if (!node) continue;
    const radius = Number.parseFloat(getComputedStyle(node).borderTopLeftRadius);
    if (radius > 0) return radius;
  }
  return 0;
}

/**
 * Grows the image laid out at `to` out of the thumbnail at `from`. A thumbnail crops its image to
 * cover the tile, so the image scales evenly and a clip path trims it to the tile's shape: a scale
 * on each axis would stretch the picture.
 */
function zoomKeyframes(from: DOMRect, to: DOMRect, fromRadius: number, toRadius: number): Keyframe[] {
  const scale = Math.max(from.width / to.width, from.height / to.height);
  const x = from.left + from.width / 2 - (to.left + to.width / 2);
  const y = from.top + from.height / 2 - (to.top + to.height / 2);
  const insetX = Math.max(0, (to.width - from.width / scale) / 2);
  const insetY = Math.max(0, (to.height - from.height / scale) / 2);
  return [
    {
      transform: `translate(${x}px, ${y}px) scale(${scale})`,
      clipPath: `inset(${insetY}px ${insetX}px round ${fromRadius / scale}px)`,
    },
    { transform: "none", clipPath: `inset(0px 0px round ${toRadius}px)` },
  ];
}

const FADE_KEYFRAMES: Keyframe[] = [
  { opacity: 0, transform: "scale(0.96)" },
  { opacity: 1, transform: "none" },
];

/** A full-window viewer for the images of one message. It opens with a zoom out of the thumbnail. */
export function ImageLightbox(props: {
  opening: ImageLightboxOpening;
  /** Finds the thumbnail of an image, so the viewer closes back into the one it shows. */
  thumbnail?: (attachment: AttachmentSummary) => HTMLElement | undefined;
  onDownload?: ((attachment: AttachmentSummary) => void) | undefined;
  /** Absent, every image can download. */
  canDownload?: ((attachment: AttachmentSummary) => boolean) | undefined;
  /** The window draws the macOS window controls over the top start corner, so the toolbar leaves room. */
  macWindowControls?: boolean | undefined;
  onClose: () => void;
}) {
  const { t } = useText();
  const motion = !prefersReducedMotion();
  const originRect = untrack(() => (motion ? visibleRect(props.opening.origin) : undefined));
  const openedId = untrack(() => props.opening.images[props.opening.index]?.id);
  // The viewer unmounts while it is still open, so Kobalte does not give focus back. The viewer does.
  const opener =
    untrack(() => props.opening.origin) ??
    (document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : undefined);
  const [index, setIndex] = createSignal(untrack(() => Math.max(0, props.opening.index)));
  const [direction, setDirection] = createSignal(0);
  const [closing, setClosing] = createSignal(false);
  const [loaded, setLoaded] = createStore<Record<string, boolean>>({});
  const [failed, setFailed] = createStore<Record<string, boolean>>({});
  const images = () => props.opening.images;
  const current = createMemo(() => images()[Math.min(index(), images().length - 1)]);
  const downloadable = () => {
    const image = current();
    return image && (props.canDownload?.(image) ?? true) ? image : undefined;
  };
  const imageElements = new Map<string, HTMLImageElement>();
  const tiles = createTileMotion();
  // The thumbnails move only when the viewer grows out of one of them.
  const tilesMove = Boolean(originRect && props.thumbnail);
  let overlay: HTMLElement | undefined;
  let track: HTMLDivElement | undefined;
  let slide: Animation | undefined;
  let opened = false;
  let swipeStart: { x: number; y: number } | undefined;
  let swiped = false;
  // The zoom writes the image's `scale` and `translate` styles, so the open, close and slide
  // animations of its `transform` still apply on top.
  const [zoom, setZoom] = createSignal(1);
  const [zoomed, setZoomed] = createSignal(false);
  let stage: HTMLDivElement | undefined;
  let camera = FIT;
  const pointers = new Map<number, Point>();
  let gesture: { camera: Camera; point: Point; distance: number } | undefined;

  /** The loaded image of `entry`, which the zoom moves. */
  const zoomImage = (entry = current()) => {
    const image = entry ? imageElements.get(entry.id) : undefined;
    return image?.isConnected && image.complete && image.naturalWidth ? image : undefined;
  };
  /** The scale over the fitted size, from the fitted size to MAX_SCALE times the natural size. */
  const limited = (scale: number, image: HTMLImageElement) =>
    Math.min(Math.max(scale, 1), Math.max(1, (MAX_SCALE * image.naturalWidth) / image.offsetWidth));
  /** A zoomed image keeps its edges outside the stage edges; a smaller one stays centred. */
  const settled = (from: Camera, image: HTMLImageElement): Camera => {
    const scale = limited(from.scale, image);
    const axis = (position: number, size: number, length: number) => {
      const room = Math.max(0, (size * scale - length) / 2);
      return Math.min(Math.max(position, -room), room);
    };
    return {
      scale,
      x: axis(from.x, image.offsetWidth, stage?.clientWidth ?? 0),
      y: axis(from.y, image.offsetHeight, stage?.clientHeight ?? 0),
    };
  };
  /** Buttons, keys and a double-click glide to the new zoom; a drag, a scroll or a pinch follows at once. */
  const move = (next: Camera, animate = false, entry = current()) => {
    const image = zoomImage(entry);
    camera = image ? settled(next, image) : FIT;
    const isZoomed = camera.scale > 1;
    setZoomed(isZoomed);
    if (!image) {
      // An image that is not loaded, or that failed, does not show the level of the one before.
      setZoom(1);
      stage?.removeAttribute("data-zoomed");
      return;
    }
    // Layout sizes, not `getBoundingClientRect`: the zoom and the animations transform the image.
    setZoom((camera.scale * image.offsetWidth) / image.naturalWidth);
    const glide = animate && motion;
    image.toggleAttribute("data-settling", glide);
    // A glide back to fit keeps the clip and the sharp drawing until the image is fitted.
    if (glide && !isZoomed && image.hasAttribute("data-zoomed")) {
      const fitted = () => {
        if (camera.scale > 1) return;
        stage?.removeAttribute("data-zoomed");
        image.removeAttribute("data-zoomed");
      };
      image.addEventListener("transitionend", fitted, { once: true });
    } else {
      stage?.toggleAttribute("data-zoomed", isZoomed);
      image.toggleAttribute("data-zoomed", isZoomed);
    }
    image.style.scale = isZoomed ? String(camera.scale) : "";
    image.style.translate = isZoomed ? `${camera.x}px ${camera.y}px` : "";
  };
  /** The camera at `scale` that keeps the image point under `point` where it is. */
  const zoomAround = (from: Camera, point: Point, scale: number): Camera => {
    const image = zoomImage();
    const next = image ? limited(scale, image) : 1;
    return {
      scale: next,
      x: point.x - ((point.x - from.x) * next) / from.scale,
      y: point.y - ((point.y - from.y) * next) / from.scale,
    };
  };
  const zoomBy = (factor: number) => move(zoomAround(camera, { x: 0, y: 0 }, camera.scale * factor), true);
  /** A window point from the centre of the stage, where the fitted image is centred. */
  const stagePoint = (event: MouseEvent): Point => {
    const rect = stage?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 };
  };
  /** One pointer drags a zoomed image; two pinch it. */
  const startGesture = () => {
    const [first, second] = [...pointers.values()];
    gesture =
      first && (second || zoomed())
        ? {
            camera,
            point: second ? { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 } : first,
            distance: second ? Math.hypot(second.x - first.x, second.y - first.y) : 0,
          }
        : undefined;
    if (gesture) stage?.setAttribute("data-dragging", "");
    else stage?.removeAttribute("data-dragging");
  };

  onSettled(() => {
    const area = stage;
    if (!area) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      // A trackpad pinch arrives as a wheel event with Ctrl held.
      if (event.ctrlKey || event.metaKey) {
        move(zoomAround(camera, stagePoint(event), camera.scale * Math.exp(-event.deltaY * WHEEL_ZOOM_RATE)));
        return;
      }
      if (!zoomed()) return;
      const sideways = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
      const down = event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY;
      move({ ...camera, x: camera.x - sideways, y: camera.y - down });
    };
    const onDown = (event: PointerEvent) => {
      // A touch can start a pinch; a mouse only drags an image that is zoomed in. The step buttons
      // on the stage keep their clicks.
      if (event.button !== 0 || !zoomImage() || (event.pointerType === "mouse" && !zoomed())) return;
      if (event.target instanceof Element && event.target.closest("button")) return;
      pointers.set(event.pointerId, stagePoint(event));
      startGesture();
    };
    const onMove = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, stagePoint(event));
      const start = gesture;
      const [first, second] = [...pointers.values()];
      if (!start || !first) return;
      const point = second ? { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 } : first;
      const from =
        second && start.distance
          ? zoomAround(
              start.camera,
              start.point,
              (start.camera.scale * Math.hypot(second.x - first.x, second.y - first.y)) / start.distance,
            )
          : start.camera;
      move({ ...from, x: from.x + point.x - start.point.x, y: from.y + point.y - start.point.y });
      // The capture waits for a drag: a captured click lands on the stage, and that closes the viewer.
      if (Math.hypot(point.x - start.point.x, point.y - start.point.y) <= DRAG_DISTANCE) return;
      swiped = true;
      if (!area.hasPointerCapture(event.pointerId)) area.setPointerCapture(event.pointerId);
    };
    const onUp = (event: PointerEvent) => {
      if (pointers.delete(event.pointerId)) startGesture();
    };
    const onDoubleClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".image-lightbox-image")) return;
      if (zoomed()) move(FIT, true);
      else move(zoomAround(camera, stagePoint(event), DOUBLE_CLICK_ZOOM), true);
    };
    const onResize = new ResizeObserver(() => {
      // A new fitted size keeps the zoom level, the percent of the natural size.
      const image = zoomImage();
      move(image && zoomed() ? { ...camera, scale: (zoom() * image.naturalWidth) / image.offsetWidth } : camera);
    });
    area.addEventListener("wheel", onWheel, { passive: false });
    area.addEventListener("pointerdown", onDown);
    area.addEventListener("pointermove", onMove);
    area.addEventListener("pointerup", onUp);
    area.addEventListener("pointercancel", onUp);
    area.addEventListener("dblclick", onDoubleClick);
    onResize.observe(area);
    return () => {
      area.removeEventListener("wheel", onWheel);
      area.removeEventListener("pointerdown", onDown);
      area.removeEventListener("pointermove", onMove);
      area.removeEventListener("pointerup", onUp);
      area.removeEventListener("pointercancel", onUp);
      area.removeEventListener("dblclick", onDoubleClick);
      onResize.disconnect();
    };
  });

  onSettled(() => {
    if (!motion) return;
    overlay?.animate([{ opacity: 0 }, { opacity: 1 }], BACKDROP_IN);
    if (!originRect) return;
    for (const entry of images()) {
      const tile = entry.id === openedId ? undefined : props.thumbnail?.(entry);
      if (tile) tiles.recede(tile, originRect, false);
    }
  });
  onCleanup(() => tiles.cancel());

  /** Where a slide sits on the track: -1, 0 or 1 is before, on or after the stage; others do not mount. */
  const slideOffset = (position: number): -1 | 0 | 1 | undefined => {
    const count = images().length;
    const offset = (position - index() + count) % count;
    if (offset === 0) return 0;
    // With two images, the other one is on the side that the viewer came from.
    if (count === 2) return direction() > 0 ? -1 : 1;
    if (offset === 1) return 1;
    if (offset === count - 1) return -1;
    return undefined;
  };

  const reveal = (shown: AttachmentSummary, element: HTMLImageElement) => {
    setLoaded((state) => {
      state[shown.id] = true;
    });
    if (shown.id === current()?.id) move(FIT);
    if (opened || shown.id !== current()?.id) return;
    opened = true;
    if (!motion) return;
    // After a step before the first load, the image shown is not the thumbnail's image.
    if (originRect && shown.id === openedId) {
      element.animate(
        zoomKeyframes(
          originRect,
          element.getBoundingClientRect(),
          cornerRadius(props.opening.origin),
          cornerRadius(element),
        ),
        ZOOM_IN,
      );
      element.animate([{ opacity: 0 }, { opacity: 1 }], IMAGE_FADE_IN);
      const tile = tilesMove ? props.thumbnail?.(shown) : undefined;
      if (tile) tiles.hide(tile, TILE_HIDE_DURATION);
    } else {
      element.animate(FADE_KEYFRAMES, IMAGE_FADE_IN);
    }
  };

  /** Shows the image at `next`. A step to a neighbour slides the track; a jump fades the image in. */
  const go = (next: number, offset: number) => {
    if (next === index() || closing()) return;
    const previous = current();
    const count = images().length;
    const distance = (next - index() + count) % count;
    const neighbour = count === 2 || distance === (offset > 0 ? 1 : count - 1);
    // A step during a slide goes on from where the track is now.
    const from = motion && track ? new DOMMatrixReadOnly(getComputedStyle(track).transform).m41 : 0;
    slide?.cancel();
    move(FIT);
    setDirection(offset);
    setIndex(next);
    move(FIT, false, images()[next]);
    const shown = current();
    if (tilesMove && originRect && previous && shown) {
      const left = props.thumbnail?.(previous);
      const entered = props.thumbnail?.(shown);
      if (entered) tiles.hide(entered, 0);
      if (left) tiles.recede(left, originRect, true);
    }
    if (!motion || !track) return;
    slide = neighbour
      ? track.animate(
          [{ transform: `translateX(${from + offset * track.clientWidth}px)` }, { transform: "none" }],
          SLIDE,
        )
      : track.animate(FADE_KEYFRAMES, IMAGE_FADE_IN);
  };

  const step = (offset: number) => {
    const count = images().length;
    if (count < 2) return;
    go((index() + offset + count) % count, offset);
  };

  const close = () => {
    if (closing()) return;
    setClosing(true);
    slide?.cancel();
    const shown = current();
    const thumbnail = shown
      ? (props.thumbnail?.(shown) ?? (shown.id === openedId ? props.opening.origin : undefined))
      : undefined;
    const animations: Animation[] = [];
    if (motion && shown) {
      const image = imageElements.get(shown.id);
      const target = visibleRect(thumbnail);
      const imageRect = image?.isConnected && loaded[shown.id] ? image.getBoundingClientRect() : undefined;
      // A zoomed image fades where it is, rather than shrink into a thumbnail it no longer matches.
      if (image && imageRect && target && thumbnail && !zoomed()) {
        animations.push(
          image.animate(
            zoomKeyframes(target, imageRect, cornerRadius(thumbnail), cornerRadius(image)).reverse(),
            ZOOM_OUT,
          ),
          image.animate(IMAGE_FADE_OUT_KEYFRAMES, IMAGE_FADE_OUT),
        );
        tiles.restore(thumbnail, ZOOM_OUT_DURATION);
      } else if (image?.isConnected) {
        animations.push(image.animate([...FADE_KEYFRAMES].reverse(), { ...IMAGE_FADE_IN, fill: "forwards" }));
      }
      tiles.returnAll();
      if (overlay) animations.push(overlay.animate([{ opacity: 1 }, { opacity: 0 }], BACKDROP_OUT));
    }
    const focusTarget = thumbnail?.isConnected ? thumbnail : opener;
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      props.onClose();
      window.requestAnimationFrame(() => {
        if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
      });
    });
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay ref={overlay} class="image-lightbox-backdrop" />
        <Dialog.Content
          class={`image-lightbox${props.macWindowControls ? " image-lightbox-mac-controls" : ""}`}
          data-dialog-surface="unstyled"
          data-closing={closing() ? "" : undefined}
          onPointerDown={(event: PointerEvent) => {
            swiped = false;
            swipeStart =
              event.pointerType === "mouse" || zoomed() || pointers.size > 1
                ? undefined
                : { x: event.clientX, y: event.clientY };
          }}
          onPointerUp={(event: PointerEvent) => {
            const start = swipeStart;
            swipeStart = undefined;
            if (!start) return;
            const x = event.clientX - start.x;
            if (Math.abs(x) < SWIPE_DISTANCE || Math.abs(x) < Math.abs(event.clientY - start.y)) return;
            swiped = true;
            step(x < 0 ? 1 : -1);
          }}
          onPointerCancel={() => {
            swipeStart = undefined;
          }}
          onClick={(event: MouseEvent) => {
            // A click anywhere but the image or a control closes the viewer, as a click beside a
            // dialog does.
            if (swiped) swiped = false;
            else if (event.target instanceof Element && !event.target.closest("button, a, .image-lightbox-image"))
              close();
          }}
          onKeyDown={(event: KeyboardEvent) => {
            const offset = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
            if (offset !== undefined) step(offset);
            else if (event.key === "Home") go(0, -1);
            else if (event.key === "End") go(images().length - 1, 1);
            // With Command, Ctrl or Alt, the keys are the app's own zoom shortcuts.
            else if (event.metaKey || event.ctrlKey || event.altKey) return;
            else if (event.key === "+" || event.key === "=") zoomBy(ZOOM_STEP);
            else if (event.key === "-") zoomBy(1 / ZOOM_STEP);
            else if (event.key === "0") move(FIT, true);
            else return;
            event.preventDefault();
          }}
        >
          <Dialog.Title class="sr-only">{current()?.name}</Dialog.Title>
          <header class="image-lightbox-toolbar image-lightbox-chrome">
            <span class="image-lightbox-caption">
              <span class="image-lightbox-name">{current()?.name}</span>
              <Show when={images().length > 1}>
                <span class="image-lightbox-position" aria-live="polite">
                  {t("chat.image.lightbox.position", { current: index() + 1, total: images().length })}
                </span>
              </Show>
            </span>
            <div class="image-lightbox-actions">
              <ZoomControls
                class="image-lightbox-zoom"
                levelClass="image-lightbox-zoom-level"
                buttonClass="image-lightbox-action"
                zoom={zoom()}
                onZoomOut={() => zoomBy(1 / ZOOM_STEP)}
                onFit={() => move(FIT, true)}
                onZoomIn={() => zoomBy(ZOOM_STEP)}
              />
              <Show when={props.onDownload && downloadable()}>
                {(shown) => (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    type="button"
                    class="image-lightbox-action"
                    aria-label={t("chat.image.download", { name: shown().name })}
                    title={t("chat.image.download", { name: shown().name })}
                    onClick={() => props.onDownload?.(shown())}
                  >
                    <DownloadIcon />
                  </Button>
                )}
              </Show>
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                class="image-lightbox-action"
                aria-label={t("chat.image.lightbox.close")}
                title={t("chat.image.lightbox.close")}
                data-cuelume-tap="close"
                onClick={close}
              >
                <CloseIcon />
              </Button>
            </div>
          </header>
          <div ref={(element) => (stage = element)} class="image-lightbox-stage">
            <div ref={(element) => (track = element)} class="image-lightbox-track">
              <For each={images()}>
                {(entry, position) => {
                  const offset = () => slideOffset(position());
                  return (
                    <Show when={offset() !== undefined}>
                      {/* The neighbours load before a step, so the slide shows them at once. */}
                      <div
                        class="image-lightbox-slide"
                        style={{ "--image-lightbox-slide": offset() ?? 0 }}
                        aria-hidden={offset() === 0 ? undefined : "true"}
                      >
                        <Show
                          when={failed[entry.id] !== true}
                          fallback={
                            <p class="image-lightbox-error" role={offset() === 0 ? "alert" : undefined}>
                              {t("chat.image.previewUnavailable")}
                            </p>
                          }
                        >
                          <img
                            ref={(element) => imageElements.set(entry.id, element)}
                            class={["image-lightbox-image", { "image-lightbox-image-pending": !loaded[entry.id] }]}
                            src={entry.previewUrl ?? ""}
                            alt={entry.name}
                            referrerpolicy="no-referrer"
                            draggable={false}
                            onLoad={(event) => reveal(entry, event.currentTarget)}
                            onError={() => {
                              if (entry.id === current()?.id) opened = true;
                              setFailed((state) => {
                                state[entry.id] = true;
                              });
                            }}
                          />
                        </Show>
                      </div>
                    </Show>
                  );
                }}
              </For>
            </div>
            <Show when={images().length > 1}>
              <Button
                variant="ghost"
                size="icon"
                type="button"
                class="image-lightbox-step image-lightbox-step-previous image-lightbox-chrome"
                aria-label={t("chat.image.lightbox.previous")}
                data-cuelume-tap="navigate"
                onClick={() => step(-1)}
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                type="button"
                class="image-lightbox-step image-lightbox-step-next image-lightbox-chrome"
                aria-label={t("chat.image.lightbox.next")}
                data-cuelume-tap="navigate"
                onClick={() => step(1)}
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            </Show>
          </div>
          <Show when={images().length > 1}>
            <nav class="image-lightbox-strip image-lightbox-chrome" aria-label={t("chat.image.lightbox.strip")}>
              <For each={images()}>
                {(entry, position) => (
                  <Button
                    variant="ghost"
                    type="button"
                    class="image-lightbox-thumb"
                    aria-label={t("chat.image.preview", { name: entry.name })}
                    aria-current={position() === index() ? "true" : undefined}
                    data-cuelume-tap="navigate"
                    onClick={() => go(position(), Math.sign(position() - index()))}
                  >
                    <img
                      src={entry.previewUrl ?? ""}
                      alt=""
                      decoding="async"
                      referrerpolicy="no-referrer"
                      draggable={false}
                    />
                  </Button>
                )}
              </For>
            </nav>
          </Show>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
