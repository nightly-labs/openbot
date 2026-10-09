import type { BrowserViewCursor } from "@openbot/contracts/team-protocol/browser-view-v1";
import {
  Ban,
  CircleHelp,
  Crosshair,
  Grab,
  Hand,
  LoaderCircle,
  type LucideIcon,
  Move,
  MoveDiagonal,
  MoveDiagonal2,
  MoveHorizontal,
  MoveVertical,
  Plus,
  Pointer,
  TextCursor,
  ZoomIn,
  ZoomOut,
} from "lucide-react-native";
import { View } from "react-native";
import Animated, { type SharedValue, useAnimatedStyle } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import type { Point, Rect, Zoom } from "../model/live-view-geometry";

/** The drawn size of the pointer, in points. It does not grow with the zoom, as a real pointer does not. */
const CURSOR_SIZE = 26;
/** The icons are drawn in a 24-unit box. */
const UNITS = 24;
// The pointer shows over any page, so it is black with a white edge, as a desktop pointer is.
// These are the pointer's own colors, not theme colors.
const INK = "#000000";
const EDGE = "#ffffff";

/** The icon of each cursor, and the point of the icon that is the pointer's position. */
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
  // A page that hides its pointer still needs one on a phone, so `none` shows the arrow.
  return cursor === "default" || cursor === "none" || cursor === "progress" ? null : GLYPHS[cursor];
}

/** The page's cursor at the pointer, over the frame. It takes no touches. */
export function BrowserCursor({
  cursor,
  pointer,
  fitted,
  zoom,
}: {
  cursor: BrowserViewCursor;
  /** The pointer, as a fraction of the page. */
  pointer: SharedValue<Point>;
  /** The page fitted into the stage, before the zoom. */
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

/** A line icon drawn twice: a wide white line under a black one, so it shows on dark and light pages. */
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
