import {
  type ChatBackdropCells,
  type ChatBackdropScene,
  paintChatBackdropScene,
} from "@openbot/brand/chat-backdrop-scenes";
import { Canvas, createPicture, Picture, type SkColor, Skia, type SkPicture } from "@shopify/react-native-skia";
import { useEffect, useRef, useState } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import { useSharedValue } from "react-native-reanimated";

/** The side of one mosaic cell in points, as the desktop scene draws it in CSS pixels. */
const CELL = 6;
/** About 15 frames each second: the scenes move slowly, and the JavaScript thread also runs the chat. */
const FRAME_MS = 66;
/** The time of the first frame, as the still frame of the desktop with reduced motion. */
const STILL_TIME = 42;
/**
 * The scene time of the last frame that a view drew. A new view, such as the chat after Home, goes on
 * from it, so the scene does not start again on each screen.
 */
let lastTime = STILL_TIME;

const EMPTY = createPicture(() => undefined);
const colors = new Map<string, SkColor>();

function skiaColor(value: string): SkColor {
  let color = colors.get(value);
  if (!color) {
    color = Skia.Color(value);
    colors.set(value, color);
  }
  return color;
}

/** One frame in cells, scaled up to points. Each fill is a whole number of cells, so the edges stay sharp. */
function framePicture(scene: ChatBackdropScene, width: number, height: number, time: number, dark: boolean) {
  return createPicture(
    (canvas) => {
      const paint = Skia.Paint();
      paint.setAntiAlias(false);
      canvas.scale(CELL, CELL);
      const cells: ChatBackdropCells = {
        fill(x, y, w, h, color, alpha) {
          paint.setColor(skiaColor(color));
          paint.setAlphaf(alpha);
          canvas.drawRect(Skia.XYWHRect(x, y, w, h), paint);
        },
      };
      paintChatBackdropScene(cells, { scene, width, height, time, dark });
    },
    { width: width * CELL, height: height * CELL },
  );
}

/**
 * A built-in scene of the desktop (`@openbot/brand/chat-backdrop-scenes`), drawn with Skia. It moves
 * only while `animate` is true: the caller stops it when its screen is hidden or covered by a sheet,
 * the app is in the background, or motion is reduced. A stop keeps the frame that shows, and the scene
 * goes on from that time when it moves again.
 */
export function ChatBackdropSceneView({
  scene,
  dark,
  animate,
}: {
  scene: ChatBackdropScene;
  dark: boolean;
  animate: boolean;
}) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const picture = useSharedValue<SkPicture>(EMPTY);
  /** The scene time of the frame that shows. */
  const time = useRef(lastTime);
  /** What the frame that shows was drawn for. A stop keeps it while it is still right. */
  const drawn = useRef<string | null>(null);
  const onLayout = (event: LayoutChangeEvent) => {
    const width = Math.max(1, Math.ceil(event.nativeEvent.layout.width / CELL));
    const height = Math.max(1, Math.ceil(event.nativeEvent.layout.height / CELL));
    setSize((current) => (current?.width === width && current.height === height ? current : { width, height }));
  };

  useEffect(() => {
    if (!size) return;
    const look = `${scene}:${dark}:${size.width}x${size.height}`;
    const draw = (at: number) => {
      time.current = at;
      // Only a moving scene sets the time for the next view; a still one keeps its own time.
      if (animate) lastTime = at;
      drawn.current = look;
      picture.set(framePicture(scene, size.width, size.height, at, dark));
    };
    if (!animate) {
      // Stopped: the frame stays. A new scene, theme or size draws one frame at the same time.
      if (drawn.current !== look) draw(time.current);
      return;
    }
    const from = time.current;
    const start = Date.now();
    draw(from);
    const timer = setInterval(() => draw(from + (Date.now() - start) / 1000), FRAME_MS);
    return () => clearInterval(timer);
  }, [scene, dark, animate, size, picture]);

  return (
    <View style={{ flex: 1 }} onLayout={onLayout} pointerEvents="none">
      {size ? (
        <Canvas style={{ flex: 1 }} accessible={false} accessibilityElementsHidden pointerEvents="none">
          <Picture picture={picture} />
        </Canvas>
      ) : null}
    </View>
  );
}
