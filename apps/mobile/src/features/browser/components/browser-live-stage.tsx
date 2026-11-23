import type { BrowserViewCursor, BrowserViewInput } from "@openbot/contracts/team-protocol/browser-view-v1";
import { Canvas, FilterMode, Group, Image, MipmapMode, type SkImage } from "@shopify/react-native-skia";
import { type Ref, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { type LayoutChangeEvent, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector, type TouchData } from "react-native-gesture-handler";
import { type SharedValue, useDerivedValue, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { haptics } from "@/shared/lib/haptics";
import {
  clampZoom,
  fittedRect,
  fromFraction,
  NO_ZOOM,
  type Point,
  type Rect,
  revealFraction,
  type Size,
  shownRect,
  visibleCenter,
  type Zoom,
} from "../model/live-view-geometry";
import {
  createLiveViewGestures,
  type LiveViewButton,
  type LiveViewGestureHost,
  type LiveViewMode,
  type LiveViewPinch,
  pinchedZoom,
} from "../model/live-view-gestures";
import { BrowserCursor } from "./browser-cursor";

const POINTER_MARGIN = 32;
const CENTER: Point = { x: 0.5, y: 0.5 };
const EMPTY_RECT: Rect = { x: 0, y: 0, width: 0, height: 0 };
const SAMPLING = { filter: FilterMode.Linear, mipmap: MipmapMode.None };

export interface BrowserLiveStageHandle {
  recenterPointer(): void;
  pointerPosition(): Point | null;
}

function touch(data: TouchData) {
  "worklet";
  return { id: data.id, x: data.x, y: data.y };
}

export function BrowserLiveStage({
  ref,
  image,
  frame,
  cursor,
  mode,
  drawnSequence,
  send,
  accessibilityLabel,
}: {
  ref?: Ref<BrowserLiveStageHandle>;
  image: SharedValue<SkImage | null>;
  frame: Size | null;
  cursor: BrowserViewCursor;
  mode: LiveViewMode;
  drawnSequence: () => number | null;
  send: (input: BrowserViewInput) => void;
  accessibilityLabel: string;
}) {
  const [stage, setStage] = useState<Size>({ width: 0, height: 0 });
  const fitted = useSharedValue<Rect>(EMPTY_RECT);
  const zoom = useSharedValue<Zoom>(NO_ZOOM);
  const pointer = useSharedValue<Point>(CENTER);
  const pinch = useSharedValue<LiveViewPinch | null>(null);
  const current = useRef({
    stage,
    frame,
    mode,
    zoom: NO_ZOOM,
    pinching: false,
    pointer: CENTER,
    drawnSequence,
    send,
  });
  current.current.stage = stage;
  current.current.frame = frame;
  current.current.mode = mode;
  current.current.drawnSequence = drawnSequence;
  current.current.send = send;

  const setZoom = useCallback(
    (next: Zoom) => {
      current.current.zoom = next;
      if (!current.current.pinching) zoom.value = next;
    },
    [zoom],
  );
  const setPinch = useCallback(
    (start: LiveViewPinch | null) => {
      current.current.pinching = start !== null;
      pinch.value = start;
      if (!start) zoom.value = current.current.zoom;
    },
    [pinch, zoom],
  );
  const setPointer = useCallback(
    (next: Point) => {
      current.current.pointer = next;
      pointer.value = next;
      const { stage: size, frame: page } = current.current;
      if (current.current.mode === "trackpad" && page)
        setZoom(revealFraction(size, page, current.current.zoom, next, POINTER_MARGIN));
    },
    [pointer, setZoom],
  );

  const rect = useMemo(() => fittedRect(stage, frame ?? { width: 0, height: 0 }), [stage, frame]);
  useEffect(() => {
    fitted.value = rect;
    if (frame) setZoom(clampZoom(stage, frame, current.current.zoom));
  }, [fitted, rect, frame, stage, setZoom]);

  const gestures = useMemo(() => {
    const pointerInput = (
      action: "move" | "down" | "up" | "wheel",
      at: Point,
      button: LiveViewButton,
      clickCount: number,
      deltaX = 0,
      deltaY = 0,
    ): BrowserViewInput => {
      const sequence = current.current.drawnSequence();
      return {
        type: "pointer",
        action,
        x: at.x,
        y: at.y,
        ...(sequence === null ? {} : { sequence }),
        button,
        clickCount: Math.min(3, Math.max(1, clickCount)),
        deltaX,
        deltaY,
        modifiers: 0,
      };
    };
    const host: LiveViewGestureHost = {
      layout: () => {
        const { stage: size, frame: page, zoom: shown } = current.current;
        return page && size.width > 0 ? { stage: size, frame: page, zoom: shown } : null;
      },
      mode: () => current.current.mode,
      pointer: () => current.current.pointer,
      setPointer,
      press: (action, at, button, clickCount) => current.current.send(pointerInput(action, at, button, clickCount)),
      wheel: (at, deltaX, deltaY) => current.current.send(pointerInput("wheel", at, "left", 1, deltaX, deltaY)),
      setZoom,
      pinch: setPinch,
      feedback: (kind) => {
        void (kind === "secondary-click" ? haptics.impact("medium") : haptics.selection());
      },
    };
    return createLiveViewGestures(host, {
      later: (milliseconds, callback) => {
        const timer = setTimeout(callback, milliseconds);
        return () => clearTimeout(timer);
      },
      frame: (callback) => {
        const id = requestAnimationFrame(callback);
        return () => cancelAnimationFrame(id);
      },
    });
  }, [setPinch, setPointer, setZoom]);
  useEffect(() => () => gestures.cancel(), [gestures]);

  useImperativeHandle(
    ref,
    () => ({
      recenterPointer: () => {
        const { stage: size, frame: page, zoom: shown } = current.current;
        if (!page) return;
        const center = visibleCenter(size, page, shown);
        setPointer(center);
        current.current.send(pointerMove(center, current.current.drawnSequence()));
      },
      pointerPosition: () => {
        const { stage: size, frame: page, zoom: shown, pointer: at } = current.current;
        return page ? fromFraction(at, shownRect(size, page, shown)) : null;
      },
    }),
    [setPointer],
  );

  const touches = useMemo(() => {
    const { down, move, up, cancel } = gestures;
    return Gesture.Manual()
      .onTouchesDown((event, manager) => {
        "worklet";
        manager.activate();
        scheduleOnRN(down, event.changedTouches.map(touch), Date.now());
      })
      .onTouchesMove((event) => {
        "worklet";
        const started = pinch.value;
        if (started) {
          const first = event.allTouches.find((held) => held.id === started.ids[0]);
          const second = event.allTouches.find((held) => held.id === started.ids[1]);
          if (first && second) zoom.value = pinchedZoom(started, first, second);
        }
        scheduleOnRN(move, event.allTouches.map(touch), Date.now());
      })
      .onTouchesUp((event, manager) => {
        "worklet";
        const lifted = event.changedTouches.map(touch);
        const remaining = event.allTouches.filter((held) => !lifted.some((finger) => finger.id === held.id));
        if (remaining.length === 0) manager.end();
        scheduleOnRN(up, lifted, Date.now());
      })
      .onTouchesCancelled((_event, manager) => {
        "worklet";
        manager.end();
        scheduleOnRN(cancel);
      });
  }, [gestures, pinch, zoom]);

  const transform = useDerivedValue(() => [
    { translateX: zoom.value.x },
    { translateY: zoom.value.y },
    { scale: zoom.value.scale },
  ]);

  return (
    <GestureDetector gesture={touches}>
      <View
        collapsable={false}
        style={StyleSheet.absoluteFill}
        accessible
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
        onLayout={(event: LayoutChangeEvent) => {
          const { width, height } = event.nativeEvent.layout;
          setStage((previous) =>
            previous.width === width && previous.height === height ? previous : { width, height },
          );
        }}
      >
        <Canvas style={StyleSheet.absoluteFill}>
          <Group transform={transform}>
            <Image
              image={image}
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              fit="fill"
              sampling={SAMPLING}
            />
          </Group>
        </Canvas>
        {frame ? <BrowserCursor cursor={cursor} pointer={pointer} fitted={fitted} zoom={zoom} /> : null}
      </View>
    </GestureDetector>
  );
}

function pointerMove(at: Point, sequence: number | null): BrowserViewInput {
  return {
    type: "pointer",
    action: "move",
    x: at.x,
    y: at.y,
    ...(sequence === null ? {} : { sequence }),
    button: "left",
    clickCount: 1,
    deltaX: 0,
    deltaY: 0,
    modifiers: 0,
  };
}
