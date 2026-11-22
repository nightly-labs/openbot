import type { BrowserViewCursor } from "@openbot/contracts/team-protocol/browser-view-v1";
import type { LucideIcon } from "lucide-react-native";
import Ban from "lucide-react-native/icons/ban";
import CircleHelp from "lucide-react-native/icons/circle-question-mark";
import Crosshair from "lucide-react-native/icons/crosshair";
import Hand from "lucide-react-native/icons/hand";
import Grab from "lucide-react-native/icons/hand-grab";
import LoaderCircle from "lucide-react-native/icons/loader-circle";
import Move from "lucide-react-native/icons/move";
import MoveDiagonal from "lucide-react-native/icons/move-diagonal";
import MoveDiagonal2 from "lucide-react-native/icons/move-diagonal-2";
import MoveHorizontal from "lucide-react-native/icons/move-horizontal";
import MoveVertical from "lucide-react-native/icons/move-vertical";
import Plus from "lucide-react-native/icons/plus";
import Pointer from "lucide-react-native/icons/pointer";
import TextCursor from "lucide-react-native/icons/text-cursor";
import ZoomIn from "lucide-react-native/icons/zoom-in";
import ZoomOut from "lucide-react-native/icons/zoom-out";
import { View } from "react-native";
import Animated, { type SharedValue, useAnimatedStyle } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import type { Point, Rect, Zoom } from "../model/live-view-geometry";

const CURSOR_SIZE = 26;
const UNITS = 24;
const INK = "#000000";
const EDGE = "#ffffff";

const GLYPHS: Record<
  Exclude<BrowserViewCursor, "default" | "none" | "progress">,
  { icon: LucideIcon; hotspot: Point }
> = {
  pointer: { icon: Pointer, hotspot: { x: 8, y: 2 } },
  text: { icon: TextCursor, hotspot: { x: 12, y: 12 } },
  "vertical-text": { icon: TextCursor, hotspot: { x: 12, y: 12 } },
  crosshair: { icon: Crosshair, hotspot: { x: 12, y: 12 } },
  cell: { icon: Plus, hotspot: { x: 12, y: 12 } },
  wait: { icon: LoaderCircle, hotspot: { x: 12, y: 12 } },
  help: { icon: CircleHelp, hotspot: { x: 12, y: 12 } },
  move: { icon: Move, hotspot: { x: 12, y: 12 } },
  grab: { icon: Hand, hotspot: { x: 12, y: 12 } },
  grabbing: { icon: Grab, hotspot: { x: 12, y: 12 } },
  "not-allowed": { icon: Ban, hotspot: { x: 12, y: 12 } },
  "zoom-in": { icon: ZoomIn, hotspot: { x: 11, y: 11 } },
  "zoom-out": { icon: ZoomOut, hotspot: { x: 11, y: 11 } },
  "ew-resize": { icon: MoveHorizontal, hotspot: { x: 12, y: 12 } },
  "col-resize": { icon: MoveHorizontal, hotspot: { x: 12, y: 12 } },
  "ns-resize": { icon: MoveVertical, hotspot: { x: 12, y: 12 } },
  "row-resize": { icon: MoveVertical, hotspot: { x: 12, y: 12 } },
  "nesw-resize": { icon: MoveDiagonal, hotspot: { x: 12, y: 12 } },
  "nwse-resize": { icon: MoveDiagonal2, hotspot: { x: 12, y: 12 } },
};
const ARROW_HOTSPOT: Point = { x: 5, y: 3 };

function glyph(cursor: BrowserViewCursor) {
  return cursor === "default" || cursor === "none" || cursor === "progress" ? null : GLYPHS[cursor];
}

export function BrowserCursor({
  cursor,
  pointer,
  fitted,
  zoom,
}: {
  cursor: BrowserViewCursor;
  pointer: SharedValue<Point>;
  fitted: SharedValue<Rect>;
  zoom: SharedValue<Zoom>;
}) {
  const shape = glyph(cursor);
  const hotspot = shape?.hotspot ?? ARROW_HOTSPOT;
  const offsetX = (hotspot.x / UNITS) * CURSOR_SIZE;
  const offsetY = (hotspot.y / UNITS) * CURSOR_SIZE;
  const style = useAnimatedStyle(() => {
    const rect = fitted.value;
    const { scale, x, y } = zoom.value;
    const at = pointer.value;
    return {
      opacity: rect.width > 0 ? 1 : 0,
      transform: [
        { translateX: (rect.x + at.x * rect.width) * scale + x - offsetX },
        { translateY: (rect.y + at.y * rect.height) * scale + y - offsetY },
      ],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[{ position: "absolute", left: 0, top: 0, width: CURSOR_SIZE, height: CURSOR_SIZE }, style]}
    >
      {shape ? <OutlinedIcon icon={shape.icon} /> : <Arrow />}
    </Animated.View>
  );
}

function Arrow() {
  return (
    <Svg width={CURSOR_SIZE} height={CURSOR_SIZE} viewBox={`0 0 ${UNITS} ${UNITS}`}>
      <Path
        d="M5 3 L5 19.6 L9.3 15.5 L12.1 21.6 L14.9 20.4 L12.2 14.4 L18 14.4 Z"
        fill={INK}
        stroke={EDGE}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function OutlinedIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <View style={{ width: CURSOR_SIZE, height: CURSOR_SIZE }}>
      <View style={{ position: "absolute", inset: 0 }}>
        <Icon size={CURSOR_SIZE} color={EDGE} strokeWidth={5} />
      </View>
      <View style={{ position: "absolute", inset: 0 }}>
        <Icon size={CURSOR_SIZE} color={INK} strokeWidth={2} />
      </View>
    </View>
  );
}
