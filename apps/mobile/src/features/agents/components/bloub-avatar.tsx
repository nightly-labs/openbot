import { BotEngine, COLOR_BY_ID } from "@norbert_bodziony/bloub";
import { bloubAvatarProfile } from "@openbot/brand/bloub-avatar";
import type { AvatarHue } from "@openbot/contracts/ipc";
import { memo, useId, useMemo } from "react";
import Animated, { type DerivedValue, useAnimatedProps } from "react-native-reanimated";
import Svg, { Circle, Defs, FeColorMatrix, Filter, G, Mask, Path, Rect } from "react-native-svg";
import { useBloubActivityFrame } from "@/features/agents/components/use-bloub-activity-frame";
import { type BloubActivityFrame, bloubActivityGeometry } from "@/features/agents/model/bloub-activity";
import { useAgentActivity } from "@/features/workspace/components/use-agent-activity";

import { useConnectionAppearance } from "@/features/workspace/components/use-connection-appearance";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";

interface BloubAvatarProps {
  agentId: string;
  hue: AvatarHue | null;
  seed: string;
  size?: number;
  animateIdle?: boolean;
}

const AVATAR_PAPER = "#f9f9f9";
const AnimatedColorMatrix = Animated.createAnimatedComponent(FeColorMatrix);
const AnimatedGroup = Animated.createAnimatedComponent(G);
const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function AvatarEye({ frame, index }: { frame: DerivedValue<BloubActivityFrame>; index: number }) {
  const props = useAnimatedProps(() => frame.get().eyes[index] ?? { d: "", opacity: 0, matrix: [1, 0, 0, 1, 0, 0] });
  return <AnimatedPath fill="#000000" animatedProps={props} />;
}

function AvatarDot({ frame, index, color }: { frame: DerivedValue<BloubActivityFrame>; index: number; color: string }) {
  const props = useAnimatedProps(() => frame.get().dots[index] ?? { cx: 0, cy: 0, r: 0, opacity: 0 });
  return <AnimatedCircle fill={color} animatedProps={props} />;
}

export function BloubAvatar({ agentId, hue, seed, size = 54, animateIdle = true }: BloubAvatarProps) {
  const { agents, servers } = useMobileWorkspace();
  const serverId = agents.find((agent) => agent.id === agentId)?.serverId;
  const disconnected = !servers.some((server) => server.id === serverId && server.state === "online");
  const activity = useAgentActivity(agentId);
  return (
    <BloubAvatarPreview
      hue={hue}
      seed={seed}
      size={size}
      animateIdle={animateIdle}
      disconnected={disconnected}
      working={!disconnected && Boolean(activity && activity.phase !== "waiting")}
    />
  );
}

export const BloubAvatarPreview = memo(function BloubAvatarPreview({
  hue,
  seed,
  size = 54,
  disconnected = false,
  working = false,
  animateIdle = true,
}: Omit<BloubAvatarProps, "agentId"> & { disconnected?: boolean; working?: boolean }) {
  const appearance = useConnectionAppearance(disconnected);
  const colorProps = useAnimatedProps(() => ({ values: [appearance.get().saturation] }));
  const appearanceProps = useAnimatedProps(() => ({ opacity: appearance.get().opacity }));
  const frame = useBloubActivityFrame(seed, working, animateIdle && !disconnected);
  const bodyProps = useAnimatedProps(() => frame.get().body);
  const maskId = `bloub-${useId().replaceAll(":", "")}`;
  const color = getBloubAvatarColor(seed, hue);

  return (
    <Svg
      accessibilityElementsHidden
      accessible={false}
      height={size}
      pointerEvents="none"
      viewBox="-158 -158 316 316"
      width={size}
    >
      <Defs>
        <Filter id={`${maskId}-offline`}>
          <AnimatedColorMatrix type="saturate" animatedProps={colorProps} />
        </Filter>
        <Mask id={maskId} x={-158} y={-158} width={316} height={316} maskUnits="userSpaceOnUse">
          <AnimatedPath fill="#ffffff" animatedProps={bodyProps} />
          <AvatarEye frame={frame} index={0} />
          <AvatarEye frame={frame} index={1} />
        </Mask>
      </Defs>
      {/* Mobile-only feedback: keep the synced avatar profile and color untouched. */}
      <AnimatedGroup filter={`url(#${maskId}-offline)`} animatedProps={appearanceProps}>
        <AnimatedPath fill={AVATAR_PAPER} animatedProps={bodyProps} />
        <Rect fill={color} height={316} mask={`url(#${maskId})`} width={316} x={-158} y={-158} />
        <AvatarDot frame={frame} index={0} color={color} />
        <AvatarDot frame={frame} index={1} color={color} />
        <AvatarDot frame={frame} index={2} color={color} />
      </AnimatedGroup>
    </Svg>
  );
});

// Choices show the same idle pose without mounting animation clocks, worklets,
// filters, or masks for every item in the picker.
export const BloubAvatarThumbnail = memo(function BloubAvatarThumbnail({
  seed,
  hue,
  size = 48,
}: Omit<BloubAvatarProps, "agentId">) {
  const frame = useMemo(() => {
    const geometry = bloubActivityGeometry(seed);
    return new BotEngine(100, "idle", geometry.radii, geometry.expression).sample(0);
  }, [seed]);
  return (
    <Svg
      accessibilityElementsHidden
      accessible={false}
      height={size}
      pointerEvents="none"
      viewBox="-158 -158 316 316"
      width={size}
    >
      <Path d={frame.bodyPath} fill={getBloubAvatarColor(seed, hue)} opacity={frame.bodyAlpha} />
      {(["left", "right"] as const).map((side) => {
        const eye = frame.eyes[side === "left" ? 0 : 1];
        return eye ? (
          <Path key={side} d={eye.d} fill={AVATAR_PAPER} opacity={eye.alpha} transform={eye.matrix} />
        ) : null;
      })}
    </Svg>
  );
});

export function getBloubAvatarColor(seed: string, hue: AvatarHue | null): string {
  const profile = bloubAvatarProfile(seed, hue);
  return COLOR_BY_ID.get(profile.color)?.hex ?? "#8b5cf6";
}
