import {
  type ChatBackdropCells,
  type ChatBackdropScene,
  paintChatBackdropScene,
} from "@openbot/brand/chat-backdrop-scenes";
import { Canvas, createPicture, Picture, type SkColor, Skia, type SkPicture } from "@shopify/react-native-skia";
import { useEffect, useRef, useState } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import { useSharedValue } from "react-native-reanimated";

const CELL = 6;
const FRAME_MS = 66;
const STILL_TIME = 42;
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
  const time = useRef(lastTime);
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
      if (animate) lastTime = at;
      drawn.current = look;
      picture.set(framePicture(scene, size.width, size.height, at, dark));
    };
    if (!animate) {
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
