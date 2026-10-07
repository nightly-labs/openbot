import type { AvatarMood } from "@openbot/brand/bloub-avatar-motion";
import type { AvatarHue } from "@openbot/contracts/ipc";
import { useIsFocused } from "expo-router";
import { Button, Typography } from "heroui-native";
import { Plus } from "lucide-react-native";
import { type StyleProp, View, type ViewStyle } from "react-native";
import Animated, { cubicBezier, Easing, FadeOut, ReduceMotion, useReducedMotion } from "react-native-reanimated";
import { useCSSVariable } from "uniwind";
import { BloubAvatarPreview } from "@/features/agents/components/bloub-avatar";
import { useText } from "@/shared/lib/text";

// CSS animations take `cubicBezier`; layout animations take a worklet `Easing` function.
const EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);
const EASE_IN_OUT = cubicBezier(0.77, 0, 0.175, 1);
const EXIT = FadeOut.duration(160)
  .easing(Easing.bezier(0.23, 1, 0.32, 1))
  .reduceMotion(ReduceMotion.Never);
const ENTER_MS = 300;
const ENTER_STAGGER_MS = 45;
const POP_IN = {
  from: { opacity: 0, transform: [{ translateY: 10 }, { scale: 0.9 }] },
  to: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] },
};
// Reduce Motion keeps the fade and drops the movement.
const FADE_IN = { from: { opacity: 0 }, to: { opacity: 1 } };
const FLOAT = { from: { transform: [{ translateY: 0 }] }, to: { transform: [{ translateY: -6 }] } };

interface SceneBot {
  seed: string;
  hue: AvatarHue;
  mood: AvatarMood;
  size: number;
  /** The center of the character, as a share of the scene. */
  x: `${number}%`;
  y: `${number}%`;
  floatMs: number;
}

// Placeholder characters only. They are not agents and do not open anything. No mood is busy:
// a working face would claim that something runs.
// They ring the centered text and action. The positions are shares of the scene, so the ring
// widens on a tall phone, and no character enters the middle band of a 550 pt scene.
const SCENE_BOTS: readonly SceneBot[] = [
  { seed: "mobile:empty-agents:main", hue: 245, mood: "responded", size: 84, x: "50%", y: "23%", floatMs: 3200 },
  { seed: "mobile:empty-agents:top-left", hue: 30, mood: "idle", size: 56, x: "17%", y: "10%", floatMs: 2800 },
  { seed: "mobile:empty-agents:top-right", hue: 185, mood: "waiting", size: 64, x: "82%", y: "12%", floatMs: 3600 },
  { seed: "mobile:empty-agents:left", hue: 55, mood: "idle", size: 34, x: "9%", y: "30%", floatMs: 2600 },
  { seed: "mobile:empty-agents:right", hue: 0, mood: "asleep", size: 32, x: "91%", y: "29%", floatMs: 3400 },
  { seed: "mobile:empty-agents:bottom-left", hue: 100, mood: "responded", size: 58, x: "21%", y: "80%", floatMs: 3000 },
  { seed: "mobile:empty-agents:bottom-right", hue: 320, mood: "asleep", size: 50, x: "80%", y: "85%", floatMs: 4000 },
  { seed: "mobile:empty-agents:edge-right", hue: 150, mood: "waiting", size: 36, x: "91%", y: "70%", floatMs: 2900 },
  { seed: "mobile:empty-agents:bottom", hue: 215, mood: "idle", size: 36, x: "52%", y: "93%", floatMs: 3300 },
];

function FloatingBot({
  bot,
  index,
  reducedMotion,
  focused,
}: {
  bot: SceneBot;
  index: number;
  reducedMotion: boolean;
  focused: boolean;
}) {
  const enterDelay = index * ENTER_STAGGER_MS;
  return (
    <Animated.View
      style={{
        position: "absolute",
        left: bot.x,
        top: bot.y,
        // The margins center the character on its point. They are static; motion uses transforms.
        marginLeft: -bot.size / 2,
        marginTop: -bot.size / 2,
        animationName: reducedMotion ? FADE_IN : POP_IN,
        animationDuration: ENTER_MS,
        animationDelay: enterDelay,
        animationFillMode: "backwards",
        animationTimingFunction: EASE_OUT,
      }}
    >
      <Animated.View
        style={
          reducedMotion
            ? undefined
            : {
                animationName: FLOAT,
                animationDuration: bot.floatMs,
                animationDelay: enterDelay + ENTER_MS,
                animationDirection: "alternate",
                animationIterationCount: "infinite",
                animationTimingFunction: EASE_IN_OUT,
                // The avatar clocks stop when the screen loses focus; the float stops with them.
                animationPlayState: focused ? "running" : "paused",
              }
        }
      >
        {/* Only the main character runs a face animation. Each SVG frame redraws a mask and a
            filter, so the others hold their face and move with the float transform alone. */}
        <BloubAvatarPreview seed={bot.seed} hue={bot.hue} mood={bot.mood} size={bot.size} animateIdle={index === 0} />
      </Animated.View>
    </Animated.View>
  );
}

/**
 * The home screen of a server with no agents: one action in the center, ringed by placeholder
 * characters. `style` sets the insets when the scene fills the screen in place of the list.
 */
export function EmptyAgentsScene({ onAddAgent, style }: { onAddAgent: () => void; style?: StyleProp<ViewStyle> }) {
  const { t } = useText();
  const actionForeground = String(useCSSVariable("--openbot-action-foreground") ?? "#141414");
  const reducedMotion = useReducedMotion();
  const focused = useIsFocused();
  return (
    <Animated.View className="flex-1" style={style} exiting={EXIT}>
      {/* The characters fill this inner box, so they stay inside the insets of the root. */}
      <View className="flex-1">
        <View
          className="absolute inset-0 overflow-hidden"
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {SCENE_BOTS.map((bot, index) => (
            <FloatingBot key={bot.seed} bot={bot} index={index} reducedMotion={reducedMotion} focused={focused} />
          ))}
        </View>
        <View className="flex-1 items-center justify-center px-8">
          <View className="items-center gap-2">
            <Typography.Heading type="h3" align="center">
              {t("mobile.agent.home.noAgents")}
            </Typography.Heading>
            <Typography.Paragraph align="center" className="text-text-secondary">
              {t("mobile.agent.home.noAgentsBody")}
            </Typography.Paragraph>
          </View>
          {/* The neutral action color: the characters carry the color of the scene. */}
          <Button size="lg" feedbackVariant="scale" className="mt-6 rounded-full bg-action px-6" onPress={onAddAgent}>
            <Plus color={actionForeground} size={18} strokeWidth={2.2} />
            <Button.Label className="font-sans font-semibold text-action-foreground">
              {t("mobile.agent.home.addAgent")}
            </Button.Label>
          </Button>
        </View>
      </View>
    </Animated.View>
  );
}
