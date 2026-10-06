"use dom";

import { useEffect, useRef } from "react";

interface DiagramCanvasProps {
  /** The diagram as an SVG image URL, drawn by the Mermaid renderer. */
  url: string;
  alt: string;
  /** The space that the floating header and the home indicator cover. */
  insets: { top: number; bottom: number };
  background: string;
  dom?: import("expo/dom").DOMProps;
}

interface Camera {
  x: number;
  y: number;
  scale: number;
}

const MAX_SCALE = 8;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DISTANCE = 24;
const TAP_SLOP = 8;
const DOUBLE_TAP_ZOOM = 2.5;
/** How far past its limits a pinch or a drag goes, as a share of the distance. */
const RUBBER_BAND = 0.35;
/** The edge of the screen that stays clear of a fitted diagram. */
const FIT_MARGIN = 16;
const SETTLE = "transform 280ms cubic-bezier(0.23, 1, 0.32, 1), width 280ms cubic-bezier(0.23, 1, 0.32, 1)";

/**
 * A diagram on a canvas: drag to move it, pinch to zoom around the fingers, double-tap to zoom
 * in or back to the whole diagram. A pinch or a drag past the limits stretches and springs back.
 * Each frame writes the image style directly, so React does not render while a finger moves. The
 * image is sized with `width`, not scaled, so the browser draws the SVG sharp at every zoom.
 * This web view does not contain Mermaid, so it opens at once.
 */
// Missing in Expo Go on Android until the props come again; see expo-go-dom.ts.
const NO_INSETS = { top: 0, bottom: 0 };

export default function DiagramCanvas({ url, alt, insets = NO_INSETS, background }: DiagramCanvasProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const area = viewport.current;
    const picture = image.current;
    if (!area || !picture) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pointers = new Map<number, { x: number; y: number }>();
    let camera: Camera = { x: 0, y: 0, scale: 1 };
    let natural = { width: 0, height: 0 };
    let gesture: { camera: Camera; mid: { x: number; y: number }; distance: number } | undefined;
    let tap: { x: number; y: number; moved: boolean } | undefined;
    let lastTap: { x: number; y: number; time: number } | undefined;
    let frame: number | undefined;

    const bounds = () => {
      const rect = area.getBoundingClientRect();
      return { width: rect.width, height: rect.height - insets.top - insets.bottom, top: insets.top };
    };
    const fitScale = () => {
      const view = bounds();
      if (!natural.width || !natural.height) return 1;
      return Math.min(
        (view.width - FIT_MARGIN * 2) / natural.width,
        (view.height - FIT_MARGIN * 2) / natural.height,
        1,
      );
    };
    const fitted = (): Camera => {
      const view = bounds();
      const scale = fitScale();
      return {
        scale,
        x: (view.width - natural.width * scale) / 2,
        y: view.top + (view.height - natural.height * scale) / 2,
      };
    };
    /** The nearest camera inside the limits: a small diagram stays centred, a large one keeps its edges on screen. */
    const settled = (from: Camera): Camera => {
      const view = bounds();
      const scale = Math.min(Math.max(from.scale, fitScale()), MAX_SCALE);
      const axis = (position: number, size: number, length: number, start: number) =>
        size <= length
          ? start + (length - size) / 2
          : Math.min(Math.max(position, start + length - size - FIT_MARGIN), start + FIT_MARGIN);
      return {
        scale,
        x: axis(from.x, natural.width * scale, view.width, 0),
        y: axis(from.y, natural.height * scale, view.height, view.top),
      };
    };
    const draw = (animate: boolean) => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = undefined;
        picture.style.transition = animate && !reducedMotion ? SETTLE : "none";
        picture.style.width = `${natural.width * camera.scale}px`;
        picture.style.transform = `translate(${camera.x}px, ${camera.y}px)`;
      });
    };
    const zoomAround = (from: Camera, scale: number, point: { x: number; y: number }): Camera => ({
      scale,
      x: point.x - ((point.x - from.x) * scale) / from.scale,
      y: point.y - ((point.y - from.y) * scale) / from.scale,
    });
    const local = (event: PointerEvent) => {
      const rect = area.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const middle = () => {
      const [first, second] = [...pointers.values()];
      if (!first) return undefined;
      return {
        mid: second ? { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 } : first,
        distance: second ? Math.hypot(first.x - second.x, first.y - second.y) : 0,
      };
    };
    const startGesture = () => {
      const now = middle();
      gesture = now ? { camera, ...now } : undefined;
    };

    const onLoad = () => {
      natural = { width: picture.naturalWidth, height: picture.naturalHeight };
      camera = fitted();
      draw(false);
      picture.style.opacity = "1";
    };
    const onDown = (event: PointerEvent) => {
      area.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, local(event));
      tap = pointers.size === 1 ? { ...local(event), moved: false } : undefined;
      startGesture();
    };
    const onMove = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId) || !gesture) return;
      const point = local(event);
      pointers.set(event.pointerId, point);
      if (tap && Math.hypot(point.x - tap.x, point.y - tap.y) > TAP_SLOP) tap.moved = true;
      const now = middle();
      if (!now) return;
      let scale = gesture.camera.scale;
      if (now.distance > 0 && gesture.distance > 0) {
        scale = (gesture.camera.scale * now.distance) / gesture.distance;
        // Past the limits the pinch slows down, so the user feels the edge.
        const low = fitScale();
        if (scale > MAX_SCALE) scale = MAX_SCALE * (scale / MAX_SCALE) ** RUBBER_BAND;
        if (scale < low) scale = low * (scale / low) ** RUBBER_BAND;
      }
      const zoomed = zoomAround(gesture.camera, scale, gesture.mid);
      const next = { scale, x: zoomed.x + now.mid.x - gesture.mid.x, y: zoomed.y + now.mid.y - gesture.mid.y };
      // A drag past the edge also slows down.
      const limit = settled(next);
      const band = scale === limit.scale ? RUBBER_BAND : 1;
      camera = { scale, x: limit.x + (next.x - limit.x) * band, y: limit.y + (next.y - limit.y) * band };
      draw(false);
    };
    const onUp = (event: PointerEvent) => {
      if (!pointers.delete(event.pointerId)) return;
      if (pointers.size > 0) {
        startGesture();
        return;
      }
      gesture = undefined;
      const ended = tap;
      tap = undefined;
      if (ended && !ended.moved) {
        const previous = lastTap;
        if (
          previous &&
          event.timeStamp - previous.time < DOUBLE_TAP_MS &&
          Math.hypot(ended.x - previous.x, ended.y - previous.y) < DOUBLE_TAP_DISTANCE
        ) {
          lastTap = undefined;
          const fit = fitScale();
          camera =
            camera.scale > fit * 1.05
              ? fitted()
              : settled(zoomAround(camera, Math.min(fit * DOUBLE_TAP_ZOOM, MAX_SCALE), ended));
          draw(true);
          return;
        }
        lastTap = { x: ended.x, y: ended.y, time: event.timeStamp };
      }
      camera = settled(camera);
      draw(true);
    };
    const onResize = () => {
      if (!natural.width) return;
      camera = settled(camera);
      draw(false);
    };

    picture.addEventListener("load", onLoad);
    if (picture.complete && picture.naturalWidth) onLoad();
    area.addEventListener("pointerdown", onDown);
    area.addEventListener("pointermove", onMove);
    area.addEventListener("pointerup", onUp);
    area.addEventListener("pointercancel", onUp);
    window.addEventListener("resize", onResize);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      picture.removeEventListener("load", onLoad);
      area.removeEventListener("pointerdown", onDown);
      area.removeEventListener("pointermove", onMove);
      area.removeEventListener("pointerup", onUp);
      area.removeEventListener("pointercancel", onUp);
      window.removeEventListener("resize", onResize);
    };
  }, [insets.top, insets.bottom]);

  return (
    <div
      ref={viewport}
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        touchAction: "none",
        userSelect: "none",
        background,
      }}
    >
      <img
        ref={image}
        src={url}
        alt={alt}
        draggable={false}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          maxWidth: "none",
          height: "auto",
          opacity: 0,
          transformOrigin: "0 0",
        }}
      />
    </div>
  );
}
