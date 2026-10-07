import { BlurView } from "expo-blur";
import { Typography } from "heroui-native";
import { Reply } from "lucide-react-native";
import { memo, useEffect, useId, useRef, useState } from "react";
import { type ColorValue, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  type SharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useCSSVariable } from "uniwind";
import { SheetScrollEdgeEffect } from "@/shared/components/sheet-scroll-edge-effect";
import { isIOS } from "@/shared/lib/platform";
import type { VoicePalette } from "../model/voice-palette";
import type { VoiceMode } from "./use-voice-mode";
import { VoiceAurora } from "./voice-aurora";

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

// One even blur over the whole chat. The blur material is a little lighter
// than the canvas, so blur layers that overlap or end part way down drew a
// grey line, and a radial blur drew a bend round its clear middle.
const CHAT_BLUR = 14;
// The chat steps back under the voice mode: it fades into the canvas colour.
// A black dim and a black vignette made a dark frame round a lighter middle,
// and turned a light chat grey. Without the blur, the veil does that work alone.
const VEIL = { blurred: 0.62, plain: 0.82 } as const;
// The top takes more of the same colour, in step with the blur, so the words
// read on a calm surface. It fades over the full height, for the same reason.
const TOP_VEIL = 0.5;
const TOP_VEIL_REACH = 1;
// The hint breathes while the recognizer listens and nothing is said yet.
const HINT_PULSE_MS = 1100;
const HINT_PULSE_LOW = 0.55;
// The glow covers the lower part of the screen, behind the voice button.
const AURORA_HEIGHT_RATIO = 0.62;
// Words that arrive together come in one after another, from the top line down.
const WORD_STAGGER_MS = 45;
const WORD_MAX_DELAY_MS = 540;
const WORD_REVEAL_MS = 380;
// Room for the header line above the first words.
const TRANSCRIPT_TOP = 72;

// A smoothstep over many stops has no edge where the fade starts or ends.
const TOP_FADE = Array.from({ length: 13 }, (_, index) => {
  const progress = index / 12;
  return { progress, opacity: 1 - progress * progress * (3 - 2 * progress) };
});

/** Solid at the top and gone at `reach` of the height, in the veil colour. */
function topFade(id: string, reach: number, color: string) {
  return (
    <Svg width="100%" height="100%">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          {TOP_FADE.map(({ progress, opacity }) => (
            <Stop key={progress} offset={reach * progress} stopColor={color} stopOpacity={opacity} />
          ))}
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

const ChatBlur = memo(function ChatBlur({ presence }: { presence: SharedValue<number> }) {
  const props = useAnimatedProps(() => ({ intensity: CHAT_BLUR * presence.get() }));
  return (
    <AnimatedBlurView
      pointerEvents="none"
      tint="systemUltraThinMaterial"
      animatedProps={props}
      style={StyleSheet.absoluteFill}
    />
  );
});

/** Hands out entrance delays, so words that mount together come in one by one. */
function createRevealQueue() {
  let next = 0;
  return () => {
    const now = Date.now();
    const delay = Math.min(Math.max(0, next - now), WORD_MAX_DELAY_MS);
    next = now + delay + WORD_STAGGER_MS;
    return delay;
  };
}

const VoiceWord = memo(function VoiceWord({ word, reserve }: { word: string; reserve: () => number }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(
      withDelay(
        reserve(),
        withTiming(1, { duration: WORD_REVEAL_MS, easing: EASE_OUT, reduceMotion: ReduceMotion.System }),
        ReduceMotion.System,
      ),
    );
  }, [progress, reserve]);
  const style = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ translateY: (1 - progress.get()) * 10 }, { scale: 0.97 + 0.03 * progress.get() }],
  }));
  return (
    // A language without spaces, such as Japanese, gives one long "word". It
    // must wrap inside the screen, not run past its edge.
    <Animated.View style={[{ maxWidth: "100%" }, style]}>
      <Typography type="h3" weight="medium">
        {word}
      </Typography>
    </Animated.View>
  );
});

function ListeningHint({ text }: { text: string }) {
  const reducedMotion = useReducedMotion();
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (reducedMotion || !text) return;
    pulse.set(
      withRepeat(withTiming(HINT_PULSE_LOW, { duration: HINT_PULSE_MS, easing: Easing.inOut(Easing.ease) }), -1, true),
    );
    return () => {
      cancelAnimation(pulse);
      pulse.set(1);
    };
  }, [pulse, reducedMotion, text]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.get() }));
  return (
    <Animated.View style={style}>
      <Typography type="h3" weight="medium">
        {text}
      </Typography>
    </Animated.View>
  );
}

function VoiceTranscript({
  text,
  hint,
  reply,
  muted,
  topInset,
  bottomInset,
}: {
  text: string;
  hint: string;
  reply: string | null;
  muted: ColorValue;
  topInset: number;
  bottomInset: number;
}) {
  const scroll = useRef<ScrollView>(null);
  const [reserve] = useState(createRevealQueue);
  // A word is known by its position: the recognizer corrects a word in place,
  // and only words at new positions come in.
  const words = text
    .split(/\s+/)
    .filter(Boolean)
    .map((word, position) => ({ word, position }));
  return (
    <ScrollView
      ref={scroll}
      style={StyleSheet.absoluteFill}
      contentContainerStyle={{
        paddingTop: topInset + TRANSCRIPT_TOP,
        paddingBottom: bottomInset,
        paddingHorizontal: 28,
      }}
      showsVerticalScrollIndicator={false}
      onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
    >
      {reply ? (
        <View className="mb-4 flex-row items-center gap-2">
          <Reply color={String(muted)} size={16} />
          <Typography.Paragraph numberOfLines={1} type="body-sm" className="flex-1 text-muted">
            {reply}
          </Typography.Paragraph>
        </View>
      ) : null}
      {words.length > 0 ? (
        <View
          accessible
          accessibilityLabel={text}
          style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 7, rowGap: 2 }}
        >
          {words.map(({ word, position }) => (
            <VoiceWord key={position} word={word} reserve={reserve} />
          ))}
        </View>
      ) : (
        <ListeningHint text={hint} />
      )}
    </ScrollView>
  );
}

/**
 * Covers the chat while the user speaks: a blur and a veil that is strongest at the top, a
 * glow in the agent's colours that follows the voice, and the words as they
 * are recognized. The voice controls stay above it, in the composer.
 */
export function VoiceOverlay({
  voice,
  palette,
  hint,
  reply,
  muted,
  topInset,
  controlsHeight,
  reducedTransparency,
}: {
  voice: VoiceMode;
  palette: VoicePalette;
  /** Shown before the first word. */
  hint: string;
  /** The message this one answers, if any. */
  reply: string | null;
  muted: ColorValue;
  topInset: number;
  /** Room the voice controls take at the bottom of the screen. */
  controlsHeight: number;
  reducedTransparency: boolean;
}) {
  const { width, height } = useWindowDimensions();
  const { presence, exit } = voice;
  const blurred = isIOS && !reducedTransparency;
  const veil = blurred ? VEIL.blurred : VEIL.plain;
  const veilStyle = useAnimatedStyle(() => ({ opacity: presence.get() * veil }));
  const topVeilStyle = useAnimatedStyle(() => ({ opacity: presence.get() * TOP_VEIL }));
  const edgeStyle = useAnimatedStyle(() => ({ opacity: presence.get() }));
  // Send carries the words down into the chat; cancel lets them fall away in place.
  const transcriptStyle = useAnimatedStyle(() => {
    const shown = presence.get();
    if (exit === "send")
      return { opacity: shown, transform: [{ translateY: (1 - shown) * 72 }, { scale: 0.9 + 0.1 * shown }] };
    if (exit === "cancel")
      return { opacity: shown * shown, transform: [{ translateY: (1 - shown) * -12 }, { scale: 0.96 + 0.04 * shown }] };
    return { opacity: shown, transform: [{ translateY: 0 }, { scale: 1 }] };
  });
  const topVeilId = `voice-top-veil-${useId().replaceAll(":", "")}`;
  const canvas = String(useCSSVariable("--openbot-bg-native-canvas"));
  return (
    <View
      // Absorbs touches, so the chat under it does not scroll or open a message.
      pointerEvents={exit ? "none" : "auto"}
      style={[StyleSheet.absoluteFill, { zIndex: 30 }]}
    >
      {blurred ? <ChatBlur presence={presence} /> : null}
      {/* Over the blur, so the blur material takes the veil colour too. */}
      <Animated.View pointerEvents="none" className="absolute inset-0 bg-background" style={veilStyle} />
      <Animated.View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[StyleSheet.absoluteFill, topVeilStyle]}
      >
        {topFade(topVeilId, TOP_VEIL_REACH, canvas)}
      </Animated.View>
      <VoiceAurora
        width={width}
        height={height * AURORA_HEIGHT_RATIO}
        level={voice.level}
        presence={presence}
        palette={palette}
      />
      <Animated.View style={[StyleSheet.absoluteFill, transcriptStyle]}>
        <VoiceTranscript
          text={voice.transcript}
          hint={hint}
          reply={reply}
          muted={muted}
          topInset={topInset}
          bottomInset={controlsHeight}
        />
      </Animated.View>
      {/* A long transcript scrolls up under the status bar. The chat header's
          top edge keeps the words from mixing with the time and the icons. */}
      <Animated.View
        pointerEvents="none"
        style={[{ position: "absolute", top: 0, left: 0, right: 0, height: topInset + TRANSCRIPT_TOP }, edgeStyle]}
      >
        <SheetScrollEdgeEffect style={StyleSheet.absoluteFill} />
      </Animated.View>
    </View>
  );
}
