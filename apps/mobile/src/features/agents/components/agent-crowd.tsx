import type { AvatarMood } from "@openbot/brand/bloub-avatar-motion";
import type { AvatarHue } from "@openbot/contracts/ipc";
import { useIsFocused } from "expo-router";
import { useThemeColor } from "heroui-native/hooks";
import type { LucideIcon } from "lucide-react-native";
import CalendarCheck from "lucide-react-native/icons/calendar-check";
import Code from "lucide-react-native/icons/code";
import PenLine from "lucide-react-native/icons/pen-line";
import Search from "lucide-react-native/icons/search";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import Animated, { cubicBezier } from "react-native-reanimated";

import { BloubAvatarPreview } from "@/features/agents/components/bloub-avatar";
import { useMotionPreference } from "@/shared/lib/motion";

const EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);
const EASE_IN_OUT = cubicBezier(0.77, 0, 0.175, 1);
const ENTER_MS = 300;
const ENTER_STAGGER_MS = 45;
const POP_IN = {
  from: { opacity: 0, transform: [{ translateY: 10 }, { scale: 0.9 }] },
  to: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] },
};
const FADE_IN = { from: { opacity: 0 }, to: { opacity: 1 } };
const FLOAT = { from: { transform: [{ translateY: 0 }] }, to: { transform: [{ translateY: -3 }] } };

export type CrowdMotion = "full" | "fade" | "none";

interface SceneBot {
  seed: string;
  hue: AvatarHue;
  mood: AvatarMood;
  size: number;
  x: `${number}%`;
  y: `${number}%`;
  floatMs: number;
}

const CROWD: readonly SceneBot[] = [
  { seed: "onboarding:hello:main", hue: 245, mood: "responded", size: 124, x: "50%", y: "54%", floatMs: 3200 },
  { seed: "onboarding:hello:left", hue: 30, mood: "idle", size: 78, x: "21%", y: "62%", floatMs: 2800 },
  { seed: "onboarding:hello:right", hue: 185, mood: "waiting", size: 86, x: "80%", y: "60%", floatMs: 3600 },
  { seed: "onboarding:hello:top-left", hue: 320, mood: "asleep", size: 60, x: "28%", y: "27%", floatMs: 3400 },
  { seed: "onboarding:hello:top-right", hue: 150, mood: "responded", size: 64, x: "72%", y: "25%", floatMs: 3000 },
  { seed: "onboarding:hello:top", hue: 280, mood: "waiting", size: 40, x: "50%", y: "12%", floatMs: 2600 },
  { seed: "onboarding:hello:far-left", hue: 55, mood: "idle", size: 42, x: "8%", y: "38%", floatMs: 3300 },
  { seed: "onboarding:hello:far-right", hue: 0, mood: "asleep", size: 44, x: "92%", y: "36%", floatMs: 2900 },
  { seed: "onboarding:hello:bottom-left", hue: 215, mood: "idle", size: 50, x: "33%", y: "88%", floatMs: 3100 },
  { seed: "onboarding:hello:bottom-right", hue: 100, mood: "responded", size: 46, x: "67%", y: "89%", floatMs: 3500 },
];

const BADGES: readonly { id: string; icon: LucideIcon; x: `${number}%`; y: `${number}%`; floatMs: number }[] = [
  { id: "code", icon: Code, x: "12%", y: "13%", floatMs: 3000 },
  { id: "write", icon: PenLine, x: "88%", y: "11%", floatMs: 3400 },
  { id: "plan", icon: CalendarCheck, x: "10%", y: "84%", floatMs: 2800 },
  { id: "search", icon: Search, x: "90%", y: "82%", floatMs: 3200 },
];
const BADGE_SIZE = 40;
const BADGE_FLOAT = { from: { transform: [{ translateY: 0 }] }, to: { transform: [{ translateY: -3 }] } };
const BADGE_DELAY_MS = 420;

export const CROWD_TOP = 52;
export const CROWD_SHARE = 3;
export const TEXT_SHARE = 2;

function share(value: `${number}%`): number {
  return Number.parseFloat(value) / 100;
}

function FloatingBot({
  bot,
  index,
  reducedMotion,
  floats,
  focused,
  instant = false,
}: {
  bot: SceneBot;
  index: number;
  reducedMotion: boolean;
  floats: boolean;
  focused: boolean;
  instant?: boolean;
}) {
  const enterDelay = index * ENTER_STAGGER_MS;
  return (
    <Animated.View
      style={{
        position: "absolute",
        left: bot.x,
        top: bot.y,
        marginLeft: -bot.size / 2,
        marginTop: -bot.size / 2,
        ...(instant
          ? null
          : {
              animationName: reducedMotion ? FADE_IN : POP_IN,
              animationDuration: ENTER_MS,
              animationDelay: enterDelay,
              animationFillMode: "backwards" as const,
              animationTimingFunction: EASE_OUT,
            }),
      }}
    >
      <Animated.View
        style={
          floats
            ? {
                animationName: FLOAT,
                animationDuration: bot.floatMs,
                animationDelay: instant ? 0 : enterDelay + ENTER_MS,
                animationDirection: "alternate",
                animationIterationCount: "infinite",
                animationTimingFunction: EASE_IN_OUT,
                animationPlayState: focused ? "running" : "paused",
              }
            : undefined
        }
      >
        <BloubAvatarPreview seed={bot.seed} hue={bot.hue} mood={bot.mood} size={bot.size} animateIdle={index === 0} />
      </Animated.View>
    </Animated.View>
  );
}

function Badge({
  badge,
  index,
  motion,
  floats,
  focused,
  instant,
}: {
  badge: (typeof BADGES)[number];
  index: number;
  motion: CrowdMotion;
  floats: boolean;
  focused: boolean;
  instant: boolean;
}) {
  const muted = String(useThemeColor("muted"));
  const Icon = badge.icon;
  return (
    <Animated.View
      className="absolute"
      style={{
        left: badge.x,
        top: badge.y,
        marginLeft: -BADGE_SIZE / 2,
        marginTop: -BADGE_SIZE / 2,
        ...(instant
          ? null
          : {
              animationName: motion === "full" ? POP_IN : FADE_IN,
              animationDuration: motion === "none" ? 0 : ENTER_MS,
              animationDelay: BADGE_DELAY_MS + index * 60,
              animationFillMode: "backwards" as const,
              animationTimingFunction: EASE_OUT,
            }),
      }}
    >
      <Animated.View
        className="items-center justify-center rounded-full bg-grouped"
        style={[
          { width: BADGE_SIZE, height: BADGE_SIZE },
          floats
            ? {
                animationName: BADGE_FLOAT,
                animationDuration: badge.floatMs,
                animationDelay: instant ? 0 : BADGE_DELAY_MS + ENTER_MS,
                animationDirection: "alternate",
                animationIterationCount: "infinite",
                animationPlayState: focused ? "running" : "paused",
              }
            : null,
        ]}
      >
        <Icon size={18} color={muted} strokeWidth={1.9} />
      </Animated.View>
    </Animated.View>
  );
}

function Departure({
  x,
  y,
  index,
  reach,
  leaving,
  motion,
  children,
}: {
  x: `${number}%`;
  y: `${number}%`;
  index: number;
  reach: number;
  leaving: boolean;
  motion: CrowdMotion;
  children: ReactNode;
}) {
  const dx = share(x) - 0.5;
  const dy = share(y) - 0.5;
  const length = Math.hypot(dx, dy) || 1;
  const flies = leaving && motion === "full";
  return (
    <Animated.View
      pointerEvents="none"
      className="absolute inset-0"
      style={{
        opacity: leaving ? 0 : 1,
        transform: [
          { translateX: flies ? (dx / length) * reach : 0 },
          { translateY: flies ? (dy / length) * reach : 0 },
          { rotate: flies ? `${dx < 0 ? -18 : 18}deg` : "0deg" },
        ],
        transitionProperty: ["opacity", "transform"],
        transitionDuration: motion === "none" ? 0 : 300,
        transitionDelay: flies ? index * 18 : 0,
        transitionTimingFunction: EASE_OUT,
      }}
    >
      {children}
    </Animated.View>
  );
}

export function AgentCrowd({
  motion,
  leaving = false,
  instant = false,
}: {
  motion: CrowdMotion;
  leaving?: boolean;
  instant?: boolean;
}) {
  const focused = useIsFocused();
  const faces = useMotionPreference("agentFaces");
  const floats = motion === "full" && faces;
  const [area, setArea] = useState({ width: 0, height: 0 });
  const reach = Math.max(area.width, area.height) * 0.9;
  return (
    <View
      className="absolute inset-0"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={({ nativeEvent: { layout } }) => setArea({ width: layout.width, height: layout.height })}
    >
      {CROWD.map((bot, index) => (
        <Departure key={bot.seed} x={bot.x} y={bot.y} index={index} reach={reach} leaving={leaving} motion={motion}>
          <FloatingBot
            bot={bot}
            index={index}
            reducedMotion={motion !== "full"}
            floats={floats}
            focused={focused}
            instant={instant}
          />
        </Departure>
      ))}
      {BADGES.map((badge, index) => (
        <Departure
          key={badge.id}
          x={badge.x}
          y={badge.y}
          index={CROWD.length + index}
          reach={reach}
          leaving={leaving}
          motion={motion}
        >
          <Badge badge={badge} index={index} motion={motion} floats={floats} focused={focused} instant={instant} />
        </Departure>
      ))}
    </View>
  );
}
