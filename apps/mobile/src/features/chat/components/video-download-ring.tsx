import { useThemeColor } from "heroui-native/hooks";
import Animated, { type CSSTransitionProperties, cubicBezier, useAnimatedProps } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { FILL, FRAME_RADIUS } from "../model/attachment-frame";
import { useGlidingProgress } from "./upload-progress";

const STROKE = 2;
// The line runs on the frame's edge, inside it, so the frame's clip does not cut it.
const INSET = STROKE / 2;
const AnimatedPath = Animated.createAnimatedComponent(Path);
const FADE: CSSTransitionProperties = {
  transitionProperty: "opacity",
  transitionDuration: 240,
  transitionTimingFunction: cubicBezier(0.23, 1, 0.32, 1),
};

/** The frame's edge, from the top centre, clockwise, and its length. */
function edge(width: number, height: number) {
  const r = FRAME_RADIUS - INSET;
  const [left, top, right, bottom] = [INSET, INSET, width - INSET, height - INSET];
  const d = [
    `M ${width / 2} ${top}`,
    `H ${right - r}`,
    `A ${r} ${r} 0 0 1 ${right} ${top + r}`,
    `V ${bottom - r}`,
    `A ${r} ${r} 0 0 1 ${right - r} ${bottom}`,
    `H ${left + r}`,
    `A ${r} ${r} 0 0 1 ${left} ${bottom - r}`,
    `V ${top + r}`,
    `A ${r} ${r} 0 0 1 ${left + r} ${top}`,
    "Z",
  ].join(" ");
  const length = 2 * (right - left - 2 * r) + 2 * (bottom - top - 2 * r) + 2 * Math.PI * r;
  return { d, length };
}

/**
 * A line on the edge of a video frame that fills clockwise as the file downloads. It fades out when
 * `done`.
 */
export function VideoDownloadRing({
  width,
  height,
  progress,
  done,
}: {
  width: number;
  height: number;
  /** From 0 to 1. */
  progress: number;
  done: boolean;
}) {
  const foreground = String(useThemeColor("foreground"));
  const value = useGlidingProgress(progress);
  const { d, length } = edge(width, height);
  const lineProps = useAnimatedProps(() => ({
    strokeDashoffset: length * (1 - value.get()),
    // A round cap draws a dot even for an empty line, so the line waits for the first byte.
    strokeOpacity: value.get() > 0.002 ? 1 : 0,
  }));
  return (
    <Animated.View pointerEvents="none" style={{ ...FILL, opacity: done ? 0 : 1, ...FADE }}>
      <Svg width={width} height={height}>
        <Path d={d} stroke={foreground} strokeOpacity={0.1} strokeWidth={STROKE} fill="none" />
        <AnimatedPath
          d={d}
          stroke={foreground}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={[length, length]}
          fill="none"
          animatedProps={lineProps}
        />
      </Svg>
    </Animated.View>
  );
}
