import { avatarHeadColor, avatarStyleForSeed } from "@openbot/brand/bloub-avatar";
import { type AvatarMood, avatarMoodIsBusy, avatarMoodPresentation } from "@openbot/brand/bloub-avatar-motion";
import type { AvatarColor, AvatarHue } from "@openbot/contracts/ipc";
import { Canvas, createPicture, Picture } from "@shopify/react-native-skia";
import { Image } from "expo-image";
import { memo, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { PixelRatio, View } from "react-native";
import Animated, {
  convertToRGBA,
  type DerivedValue,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { usePlushFrame } from "@/features/agents/components/use-plush-frame";
import { loadedPlushArt, loadPlushArt, plushPixels } from "@/features/agents/model/plush/plush-assets";
import { drawPlush, type PlushArt } from "@/features/agents/model/plush/plush-draw";
import { PLUSH_BODY_SCALE } from "@/features/agents/model/plush/plush-felt";
import { plushGeometry } from "@/features/agents/model/plush/plush-frames";
import {
  loadPlushPicture,
  type PlushPictureSpec,
  plushPictureName,
  savedPlushPicture,
} from "@/features/agents/model/plush/plush-picture";
import { useAgentActivity, useAgentListActivity } from "@/features/workspace/components/use-agent-activity";
import {
  DISCONNECTED_APPEARANCE,
  useConnectionAppearance,
} from "@/features/workspace/components/use-connection-appearance";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { agentActivityMood, type MobileAgentActivity } from "@/features/workspace/model/agent-activity";
import { showsOnline } from "@/features/workspace/model/server-status";
import { useMotionPreference } from "@/shared/lib/motion";
import { useScreenFocusedWhile } from "@/shared/lib/use-screen-focused-while";
import { AgentPhoto, type AgentPhotoProps } from "./agent-photo";

interface BloubAvatarProps extends AgentPhotoProps {
  agentId: string;
  hue: AvatarHue | null;
  /** The agent's `avatarColor`. It wins over `hue`. */
  color?: AvatarColor | null;
  seed: string;
  size?: number;
  animateIdle?: boolean;
  /** Turns the orbit rings around an agent photo while the agent works. A plush shows its felt dots. */
  rings?: boolean;
  /** The face also shows the work and the waits of the agent's side threads, as the home list does. */
  withThreads?: boolean;
}

/**
 * How a new body or colour comes in. `cut` swaps it at once: lists and grids use it, so that a
 * recycled row or many choices do not animate. `pop` shrinks the old plush away and springs the new
 * one out, as the desktop does in the agent editor.
 */
type PlushTransition = "pop" | "cut";

export function BloubAvatar({ withThreads = false, ...props }: BloubAvatarProps) {
  return withThreads ? <ListBloubAvatar {...props} /> : <ChatBloubAvatar {...props} />;
}

function ChatBloubAvatar(props: Omit<BloubAvatarProps, "withThreads">) {
  return <LiveBloubAvatar {...props} activity={useAgentActivity(props.agentId)} />;
}

function ListBloubAvatar(props: Omit<BloubAvatarProps, "withThreads">) {
  return <LiveBloubAvatar {...props} activity={useAgentListActivity(props.agentId)} />;
}

function LiveBloubAvatar({
  agentId,
  serverId: hostId,
  hue,
  color = null,
  seed,
  size = 54,
  animateIdle = true,
  rings = false,
  activity,
}: Omit<BloubAvatarProps, "withThreads"> & { activity: MobileAgentActivity | undefined }) {
  const serverId = useMobileWorkspaceSelector(
    (workspace) => hostId ?? workspace.agents.find((agent) => agent.id === agentId)?.serverId,
  );
  const disconnected = useMobileWorkspaceSelector(
    (workspace) => !workspace.servers.some((server) => server.id === serverId && showsOnline(server)),
  );
  return (
    <BloubAvatarPreview
      agentId={agentId}
      serverId={serverId}
      hue={hue}
      color={color}
      seed={seed}
      size={size}
      animateIdle={animateIdle}
      rings={rings}
      disconnected={disconnected}
      mood={disconnected ? "idle" : agentActivityMood(activity)}
    />
  );
}

interface AvatarPreviewOptions {
  disconnected?: boolean;
  mood?: AvatarMood;
  transition?: PlushTransition;
}

export const BloubAvatarPreview = memo(function BloubAvatarPreview(
  props: Omit<BloubAvatarProps, "agentId"> & AgentPhotoProps & AvatarPreviewOptions,
) {
  const size = props.size ?? 54;
  return (
    <AgentPhoto
      {...props}
      size={size}
      rings={props.rings ? !props.disconnected && avatarMoodPresentation(props.mood ?? "idle").rings : undefined}
    >
      <PlushAvatar
        seed={props.seed}
        hue={props.hue}
        color={props.color ?? null}
        size={size}
        mood={props.mood}
        animateIdle={props.animateIdle}
        disconnected={props.disconnected}
        transition={props.transition}
      />
    </AgentPhoto>
  );
});

/**
 * The felt plush of an agent. A still plush is a picture drawn once and shown by the image view, so a
 * long list costs no drawing surface per row. A plush that moves draws its frames with Skia on the UI
 * thread; it keeps its canvas once it has moved, so a face that settles does not flash. A seed of the
 * flat style shows the flat face of the desktop instead.
 */
const PlushAvatar = memo(function PlushAvatar({
  seed,
  hue,
  color,
  size,
  mood = "idle",
  animateIdle = true,
  disconnected = false,
  transition = "cut",
}: {
  seed: string;
  hue: AvatarHue | null;
  color: AvatarColor | null;
  size: number;
  mood?: AvatarMood;
  animateIdle?: boolean;
  disconnected?: boolean;
  transition?: PlushTransition;
}) {
  // Reduced motion, or the Settings switch for faces, holds the face at rest.
  const facesMove = useMotionPreference("agentFaces");
  const wantsMotion = facesMove && !disconnected && (avatarMoodIsBusy(mood) || animateIdle);
  const focused = useScreenFocusedWhile(wantsMotion);
  const animate = wantsMotion && focused;
  const [live, setLive] = useState(animate);
  if (animate && !live) setLive(true);
  const { shown, style: popStyle } = usePlushPop(seed, hue, color, transition === "pop" && facesMove);
  const appearance = useConnectionAppearance(disconnected);
  const appearanceStyle = useAnimatedStyle(() => ({ opacity: appearance.get().opacity }));
  const saturation = useDerivedValue(() => appearance.get().saturation);
  // The fur and the felt decor reach past the avatar box, as on the desktop.
  const drawn = size * PLUSH_BODY_SCALE;
  const pixels = plushPixels(drawn, PixelRatio.get());
  const picture = (
    <PlushPicture
      seed={shown.seed}
      hue={shown.hue}
      color={shown.color}
      mood={mood}
      size={drawn}
      pixels={pixels}
      saturation={disconnected ? DISCONNECTED_APPEARANCE.saturation : 1}
    />
  );
  return (
    <Animated.View pointerEvents="none" style={[{ width: size, height: size }, appearanceStyle]}>
      <Animated.View
        style={[
          { position: "absolute", left: (size - drawn) / 2, top: (size - drawn) / 2, width: drawn, height: drawn },
          popStyle,
        ]}
      >
        {avatarStyleForSeed(shown.seed) === "flat" ? (
          // A flat face holds its picture, as the desktop does. A busy agent breathes.
          <FlatBreath amount={animate ? avatarMoodPresentation(mood).breathe : 0} size={drawn}>
            {picture}
          </FlatBreath>
        ) : live ? (
          <PlushCanvas
            seed={shown.seed}
            hue={shown.hue}
            color={shown.color}
            mood={mood}
            size={drawn}
            pixels={pixels}
            animate={animate}
            saturation={saturation}
            fallback={picture}
          />
        ) : (
          picture
        )}
      </Animated.View>
    </Animated.View>
  );
});

/** One breath of the desktop: the scale goes from `1 - amount` to `1 + amount` and back in 2.6 s. */
const BREATH_MS = 1300;

function FlatBreath({ amount, size, children }: { amount: number; size: number; children: ReactNode }) {
  const scale = useSharedValue(1);
  useEffect(() => {
    if (amount <= 0) {
      scale.set(withTiming(1, { duration: 300 }));
      return;
    }
    const easing = Easing.inOut(Easing.sin);
    scale.set(
      withSequence(
        withTiming(1 - amount, { duration: BREATH_MS / 2, easing }),
        withRepeat(withTiming(1 + amount, { duration: BREATH_MS, easing }), -1, true),
      ),
    );
  }, [amount, scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return <Animated.View style={[{ width: size, height: size }, style]}>{children}</Animated.View>;
}

/** The old plush shrinks away, the new one springs out. `cut`, or reduced motion, swaps at once. */
function usePlushPop(seed: string, hue: AvatarHue | null, color: AvatarColor | null, pop: boolean) {
  const [shown, setShown] = useState({ seed, hue, color });
  const target = useRef({ seed, hue, color });
  target.current = { seed, hue, color };
  const scale = useSharedValue(1);
  const changed = shown.seed !== seed || shown.hue !== hue || shown.color !== color;
  useEffect(() => {
    if (!changed) return;
    if (!pop) {
      scale.set(1);
      setShown(target.current);
      return;
    }
    const swap = () => {
      setShown(target.current);
      scale.set(withSpring(1, { duration: 420, dampingRatio: 0.55, reduceMotion: ReduceMotion.Never }));
    };
    scale.set(
      withTiming(
        0,
        { duration: 225, easing: Easing.inOut(Easing.cubic), reduceMotion: ReduceMotion.Never },
        (finished) => {
          if (finished) scheduleOnRN(swap);
        },
      ),
    );
  }, [changed, pop, scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return { shown: changed && !pop ? { seed, hue, color } : shown, style };
}

function usePlushArt(
  seed: string,
  hue: AvatarHue | null,
  avatarColor: AvatarColor | null,
  pixels: number,
): PlushArt | null {
  const { shape } = plushGeometry(seed);
  const color = avatarHeadColor(seed, hue, avatarColor);
  const key = `${shape}|${color}|${pixels}`;
  const ready = loadedPlushArt(shape, color, pixels);
  const [loaded, setLoaded] = useState<{ key: string; art: PlushArt } | null>(null);
  useEffect(() => {
    if (ready) return;
    let current = true;
    loadPlushArt(shape, color, pixels).then(
      (art) => {
        if (current) setLoaded({ key, art });
      },
      // Without its pictures the plush keeps the still picture.
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [color, key, pixels, ready, shape]);
  return ready ?? (loaded?.key === key ? loaded.art : null);
}

function PlushCanvas({
  seed,
  hue,
  color,
  mood,
  size,
  pixels,
  animate,
  saturation,
  fallback,
}: {
  seed: string;
  hue: AvatarHue | null;
  color: AvatarColor | null;
  mood: AvatarMood;
  size: number;
  pixels: number;
  animate: boolean;
  saturation: DerivedValue<number>;
  fallback: ReactNode;
}) {
  const geometry = useMemo(() => plushGeometry(seed, mood), [seed, mood]);
  const art = usePlushArt(seed, hue, color, pixels);
  // The frames are sampled only when there is a plush to draw them on.
  const frame = usePlushFrame(geometry, animate && art !== null);
  const picture = useDerivedValue(
    () =>
      createPicture(
        (canvas) => {
          const current = frame.get();
          if (art && current) drawPlush(canvas, current, art, size, saturation.get());
        },
        { width: size, height: size },
      ),
    [art, frame, saturation, size],
  );
  if (!art) return fallback;
  return (
    <Canvas accessibilityElementsHidden accessible={false} pointerEvents="none" style={{ width: size, height: size }}>
      <Picture picture={picture} />
    </Canvas>
  );
}

/** The saved still picture of a plush. It is drawn the first time it shows. */
function usePlushPicture(spec: PlushPictureSpec): string | null {
  const name = plushPictureName(spec);
  const known = savedPlushPicture(spec);
  const [loaded, setLoaded] = useState<{ name: string; uri: string } | null>(null);
  const { seed, hue, color, mood, pixels, saturation } = spec;
  useEffect(() => {
    if (known) return;
    let current = true;
    void loadPlushPicture({ seed, hue, color, mood, pixels, saturation }).then((uri) => {
      if (current && uri) setLoaded({ name, uri });
    });
    return () => {
      current = false;
    };
  }, [color, hue, known, mood, name, pixels, saturation, seed]);
  return known ?? (loaded?.name === name ? loaded.uri : null);
}

function PlushPicture({
  seed,
  hue,
  color,
  mood,
  size,
  pixels,
  saturation,
  crossfade = false,
}: PlushPictureSpec & { size: number; crossfade?: boolean }) {
  const drawn = usePlushPicture({ seed, hue, color, mood, pixels, saturation });
  // While a new face of the same agent is drawn, the face on screen stays. A recycled row of another
  // agent clears it.
  const identity = `${seed}|${hue ?? ""}|${color ?? ""}`;
  const last = useRef<{ identity: string; uri: string } | null>(null);
  if (drawn) last.current = { identity, uri: drawn };
  const uri = drawn ?? (last.current?.identity === identity ? last.current.uri : null);
  return (
    <Image
      accessible={false}
      source={uri ? { uri } : null}
      recyclingKey={identity}
      cachePolicy="memory"
      transition={crossfade ? 150 : 0}
      style={{ width: size, height: size }}
    />
  );
}

// Choices show the same idle pose without mounting animation clocks or drawing surfaces for every
// item in the picker.
export const BloubAvatarThumbnail = memo(function BloubAvatarThumbnail(
  props: Omit<BloubAvatarProps, "agentId"> & AgentPhotoProps & { disconnected?: boolean },
) {
  return (
    <AgentPhoto {...props} size={props.size ?? 48}>
      <AvatarThumbnail {...props} />
    </AgentPhoto>
  );
});

// Draws the still plush without the photo lookup, for pickers that never show a photo.
export const AvatarThumbnail = memo(function AvatarThumbnail({
  seed,
  hue,
  color = null,
  size = 48,
  disconnected = false,
  animateColor = false,
}: Omit<BloubAvatarProps, "agentId"> & {
  disconnected?: boolean;
  /** Fades to a new colour, for a picker where the colour changes in place. */
  animateColor?: boolean;
}) {
  const drawn = size * PLUSH_BODY_SCALE;
  return (
    <View
      pointerEvents="none"
      style={{ width: size, height: size, opacity: disconnected ? DISCONNECTED_APPEARANCE.opacity : 1 }}
    >
      <View style={{ position: "absolute", left: (size - drawn) / 2, top: (size - drawn) / 2 }}>
        <PlushPicture
          seed={seed}
          hue={hue}
          color={color}
          mood="idle"
          size={drawn}
          pixels={plushPixels(drawn, PixelRatio.get())}
          saturation={disconnected ? DISCONNECTED_APPEARANCE.saturation : 1}
          crossfade={animateColor}
        />
      </View>
    </View>
  );
});

function saturateColor(color: string, saturation: number) {
  if (saturation >= 1) return color;
  const [r, g, b, a] = convertToRGBA(color);
  const gray = r * 0.213 + g * 0.715 + b * 0.072;
  const channel = (value: number) => Math.round((gray + (value - gray) * saturation) * 255);
  return `rgba(${channel(r)}, ${channel(g)}, ${channel(b)}, ${a})`;
}

export function thumbnailColor(color: string, disconnected: boolean) {
  return disconnected ? saturateColor(color, DISCONNECTED_APPEARANCE.saturation) : color;
}
