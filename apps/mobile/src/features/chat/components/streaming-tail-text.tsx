import { Typography } from "heroui-native";
import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { TextStyle } from "react-native";
import Animated, {
  interpolateColor,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { createStreamRevealPool, streamRevealWindow } from "../model/stream-reveal-pool";

const AnimatedTypography = Animated.createAnimatedComponent(Typography);
const RevealContext = createContext<ReturnType<typeof createStreamRevealPool> | null>(null);

export function StreamRevealProvider({ children }: PropsWithChildren) {
  const [pool] = useState(() => createStreamRevealPool());
  useEffect(() => () => pool.clear(), [pool]);
  return <RevealContext value={pool}>{children}</RevealContext>;
}

interface TextProps {
  text: string;
  type: "body" | "body-sm" | "h4" | "h5";
  style: TextStyle;
}

function FadingWord({ text, type, style, onDone }: TextProps & { onDone: () => void }) {
  const progress = useSharedValue(0);
  const color = String(style.color);
  useEffect(() => {
    progress.set(
      withTiming(1, { duration: 500, reduceMotion: ReduceMotion.System }, (finished) => {
        if (finished) scheduleOnRN(onDone);
      }),
    );
  }, [onDone, progress]);
  // Nested native text uses color; view opacity would break inline text layout.
  const revealStyle = useAnimatedStyle(() => ({
    color: interpolateColor(progress.get(), [0, 1], ["transparent", color]),
  }));
  return (
    <AnimatedTypography type={type} style={[style, revealStyle]}>
      {text}
    </AnimatedTypography>
  );
}

function useRevealSlot(enabled: boolean) {
  const pool = useContext(RevealContext);
  const [phase, setPhase] = useState<"waiting" | "active" | "done">(enabled ? "waiting" : "done");
  const finish = useRef<() => void>(() => {});
  const [onDone] = useState(() => () => {
    finish.current();
    setPhase("done");
  });
  useEffect(() => {
    if (!enabled || !pool) {
      setPhase("done");
      return;
    }
    return pool.add({
      start: (done) => {
        finish.current = done;
        setPhase("active");
      },
      skip: () => setPhase("done"),
    });
  }, [enabled, pool]);
  return { phase: enabled ? phase : "done", onDone };
}

function RevealedWord({
  enabled,
  end,
  onSettled,
  ...props
}: TextProps & { enabled: boolean; end: number; onSettled: (end: number) => void }) {
  const { phase, onDone } = useRevealSlot(enabled);
  useEffect(() => {
    if (phase === "done") onSettled(end);
  }, [phase, end, onSettled]);
  if (phase === "done") return props.text;
  if (phase === "waiting")
    return (
      <Typography type={props.type} style={[props.style, { color: "transparent" }]}>
        {props.text}
      </Typography>
    );
  return <FadingWord {...props} onDone={onDone} />;
}

export function StreamingBlock({ children, enabled }: PropsWithChildren<{ enabled: boolean }>) {
  const { phase, onDone } = useRevealSlot(enabled);
  const opacity = useSharedValue(enabled ? 0 : 1);
  useEffect(() => {
    if (phase === "active") {
      opacity.set(
        withTiming(1, { duration: 500, reduceMotion: ReduceMotion.System }, (finished) => {
          if (finished) scheduleOnRN(onDone);
        }),
      );
    } else {
      opacity.set(phase === "done" ? 1 : 0);
    }
  }, [phase, opacity, onDone]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  // Keep native scroll views mounted when the reveal finishes or streaming stops.
  return <Animated.View style={style}>{children}</Animated.View>;
}

export function StreamingTailText({
  body,
  enabled,
  type,
  style,
}: Omit<TextProps, "text"> & { body: string; enabled: boolean }) {
  const [baseline, setBaseline] = useState(enabled ? "" : body);
  if ((!enabled && baseline !== body) || !body.startsWith(baseline)) setBaseline(body);
  const { prefix, words } = streamRevealWindow(body, baseline, enabled);
  const settle = useCallback(
    (end: number) => {
      setBaseline((previous) => (body.startsWith(previous) && end > previous.length ? body.slice(0, end) : previous));
    },
    [body],
  );
  return (
    <>
      {prefix}
      {words.map((word) => (
        <RevealedWord
          key={word.start}
          text={word.text}
          end={word.end}
          onSettled={settle}
          type={type}
          style={style}
          enabled={enabled}
        />
      ))}
    </>
  );
}
