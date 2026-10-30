import type { AvatarHue } from "@openbot/contracts/ipc";
import { Spinner, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Mic from "lucide-react-native/icons/mic";
import MicOff from "lucide-react-native/icons/mic-off";
import Square from "lucide-react-native/icons/square";
import X from "lucide-react-native/icons/x";
import { type ReactNode, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { Extrapolation, interpolate, useAnimatedStyle } from "react-native-reanimated";
import { useAgentColorTransition } from "@/features/agents/components/agent-color-glow";
import { BloubAvatarPreview } from "@/features/agents/components/bloub-avatar";
import { getBloubAvatarColor } from "@/features/agents/model/bloub-activity";
import { useAgentActivity } from "@/features/workspace/components/use-agent-activity";
import { agentActivityMood } from "@/features/workspace/model/agent-activity";
import type { VoicePalette } from "../model/voice-palette";
import type { ComposerVoice } from "./composer-voice";
import { VoiceAurora } from "./voice-aurora";

const VOICE_BAR_AVATAR_SIZE = 40;
/** The bar is as tall as the round voice button of dictation. */
const VOICE_BUTTON_HEIGHT = 64;
const BUTTON_SIZE = 40;
/** The content rises this far into place while it fades in, after the card has its shape. */
const CONTENT_RISE = 6;

/**
 * The agent of the call bar. It stays mounted when another channel member takes over, so the face
 * morphs into the new agent's shape and the colour eases to its own, as in the agent editor, instead
 * of one avatar replacing the other. Both run on the UI thread.
 */
export function VoiceAgentAvatar({
  agentId,
  serverId,
  seed,
  hue,
}: {
  agentId: string;
  serverId: string;
  seed: string;
  hue: AvatarHue | null;
}) {
  const animatedColor = useAgentColorTransition(getBloubAvatarColor(seed, hue));
  const activity = useAgentActivity(agentId);
  return (
    <BloubAvatarPreview
      agentId={agentId}
      serverId={serverId}
      seed={seed}
      hue={hue}
      size={VOICE_BAR_AVATAR_SIZE}
      mood={agentActivityMood(activity)}
      animatedColor={animatedColor}
    />
  );
}

function BarButton({
  label,
  tint,
  background,
  disabled = false,
  busy = false,
  onPress,
  children,
}: {
  label: string;
  /** The colour of the round button. Null draws it in the bar's text colour, faintly. */
  tint: string | null;
  background: string;
  disabled?: boolean;
  busy?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => ({
        width: BUTTON_SIZE,
        height: BUTTON_SIZE,
        borderRadius: BUTTON_SIZE / 2,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.4 : 1,
        transform: [{ scale: pressed ? 0.96 : 1 }],
      })}
    >
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: BUTTON_SIZE / 2, backgroundColor: tint ?? background, opacity: tint ? 1 : 0.16 },
        ]}
      />
      {children}
    </Pressable>
  );
}

/**
 * The composer as a call bar while a live conversation is open: the agent, what the conversation
 * does and the words heard or read, and Interrupt, Mute and End. It is drawn inside the composer card,
 * which closes to the bar's shape, so the composer turns into the bar and keeps its surface: Liquid
 * Glass on iOS, else the composer's own colour. The agent's aurora glows inside the bar and follows
 * the voice. Every motion runs on the UI thread: the content follows the card's own `presence`, and
 * the aurora draws from the voice level in a frame callback.
 */
export function VoiceCallBar({
  voice,
  bar,
  avatar,
  palette,
  accent,
}: {
  voice: ComposerVoice;
  bar: NonNullable<ComposerVoice["bar"]>;
  avatar?: ReactNode;
  palette?: VoicePalette;
  /** The agent's colour for End, and the glyph colour on it. Without it End looks like Mute and Stop. */
  accent?: { fill: string; glyph: string };
}) {
  const text = String(useThemeColor("foreground"));
  const [width, setWidth] = useState(0);
  const presence = voice.presence;
  const contentStyle = useAnimatedStyle(() => {
    const shown = interpolate(presence.get(), [0.5, 1], [0, 1], Extrapolation.CLAMP);
    return { opacity: shown, transform: [{ translateY: (1 - shown) * CONTENT_RISE }] };
  });
  // Interrupt shows while the agent thinks or speaks.
  const replying = voice.trailing.enabled;
  return (
    <View
      style={StyleSheet.absoluteFill}
      onLayout={({ nativeEvent }) => setWidth(Math.round(nativeEvent.layout.width))}
    >
      {palette && width > 0 ? (
        <VoiceAurora
          width={width}
          height={VOICE_BUTTON_HEIGHT}
          level={voice.level}
          presence={presence}
          palette={palette}
        />
      ) : null}
      <Animated.View
        accessibilityRole="toolbar"
        style={[
          StyleSheet.absoluteFill,
          { flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 12, paddingRight: 12 },
          contentStyle,
        ]}
      >
        {avatar}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Typography.Paragraph numberOfLines={1} type="body-sm" style={{ color: text, fontWeight: "600" }}>
            {bar.title}
          </Typography.Paragraph>
          <Typography.Paragraph
            numberOfLines={1}
            type="body-xs"
            accessibilityLiveRegion="polite"
            style={{ color: text, opacity: 0.7 }}
          >
            {bar.caption}
          </Typography.Paragraph>
        </View>
        {replying ? (
          <BarButton label={voice.trailing.label} tint={null} background={text} onPress={voice.trailing.onPress}>
            <Square color={text} fill={text} size={13} strokeWidth={2} />
          </BarButton>
        ) : null}
        <BarButton
          label={voice.center.label}
          tint={null}
          background={text}
          disabled={!voice.center.pressable}
          busy={voice.center.busy}
          onPress={voice.center.onPress}
        >
          {voice.center.glyph === "spinner" ? (
            <Spinner size="sm" color={text} />
          ) : voice.center.glyph === "micOff" ? (
            <MicOff color={text} size={19} strokeWidth={1.8} />
          ) : (
            <Mic color={text} size={19} strokeWidth={1.8} />
          )}
        </BarButton>
        <BarButton
          label={voice.leading.label}
          tint={accent?.fill ?? null}
          background={text}
          onPress={voice.leading.onPress}
        >
          <X color={accent?.glyph ?? text} size={19} strokeWidth={2} />
        </BarButton>
      </Animated.View>
    </View>
  );
}
