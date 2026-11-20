import { Typography } from "heroui-native";
import Copy from "lucide-react-native/icons/copy";
import { useEffect, useRef } from "react";
import { type AccessibilityActionEvent, Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { ListingGradient } from "@/features/marketplace/components/listing-gradient";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { useText } from "@/shared/lib/text";

export const INVITE_NIGHT = "#0c0a10";
const PAPER = "#f6f1ea";
const INK = "#1d1822";
const INK_MUTED = "rgba(29,24,34,0.55)";
const NOTCH = 24;
const NOTCHES = 6;
const HOLE = 7;
const HOLES = Array.from({ length: 18 }, (_, index) => `hole-${index}`);
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const GRAVITY = Easing.bezier(0.45, 0, 0.9, 0.55);
const SHARE_AFTER_TEAR_MS = 260;

export interface InviteTicketProps {
  linkLabel: string;
  fromName: string;
  friendPerk: string;
  youPerk: string;
  ready: boolean;
  onCopy: () => void;
  onTear: () => Promise<void>;
}

export function InviteTicket({ linkLabel, fromName, friendPerk, youPerk, ready, onCopy, onTear }: InviteTicketProps) {
  const { t } = useText();
  const reduced = useReducedMotion();
  const enter = useSharedValue(0);
  const progress = useSharedValue(0);
  const direction = useSharedValue(1);
  const fall = useSharedValue(0);
  const reprint = useSharedValue(1);
  const kick = useSharedValue(0);
  const notch = useSharedValue(0);
  const tearWidth = useSharedValue(260);
  const tearing = useRef(false);
  const shareTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    enter.set(withTiming(1, { duration: 300, easing: EASE_OUT }));
    return () => {
      if (shareTimer.current) clearTimeout(shareTimer.current);
    };
  }, [enter]);

  function tick() {
    void haptics.selection();
  }

  function printNewStub() {
    progress.set(0);
    fall.set(0);
    reprint.set(0);
    reprint.set(withDelay(120, withTiming(1, { duration: 340, easing: EASE_OUT })));
    tearing.current = false;
  }

  function tearOff() {
    if (tearing.current || !ready) return;
    tearing.current = true;
    void haptics.impact("medium");
    kick.set(
      withSequence(
        withTiming(1, { duration: 70, easing: EASE_OUT }),
        withSpring(0, { duration: 420, dampingRatio: 0.5 }),
      ),
    );
    fall.set(withTiming(1, { duration: reduced ? 160 : 620, easing: reduced ? EASE_OUT : GRAVITY }));
    shareTimer.current = setTimeout(() => {
      shareTimer.current = null;
      void onTear().finally(printNewStub);
    }, SHARE_AFTER_TEAR_MS);
  }

  const pan = Gesture.Pan()
    .enabled(ready)
    .maxPointers(1)
    .activeOffsetX([-8, 8])
    .failOffsetY([-16, 16])
    .onUpdate((event) => {
      if (fall.get() > 0) return;
      direction.set(event.translationX >= 0 ? 1 : -1);
      const next = Math.min(Math.abs(event.translationX) / tearWidth.get(), 1);
      progress.set(next);
      const step = Math.floor(next * NOTCHES);
      if (step !== notch.get()) {
        notch.set(step);
        if (step < NOTCHES) scheduleOnRN(tick);
      }
    })
    .onEnd(() => {
      notch.set(0);
      if (fall.get() > 0) return;
      if (progress.get() >= 1) scheduleOnRN(tearOff);
      else progress.set(withSpring(0, { duration: 420, dampingRatio: 0.8 }));
    });

  const ticketStyle = useAnimatedStyle(() => ({
    opacity: enter.get(),
    transform: reduced
      ? []
      : [
          { translateY: (1 - enter.get()) * -24 - kick.get() * 6 },
          { rotate: `${(1 - enter.get()) * -2 - direction.get() * kick.get() * 0.6}deg` },
        ],
  }));

  const stubStyle = useAnimatedStyle(() => {
    const side = direction.get();
    const falling = fall.get();
    if (reduced) return { opacity: reprint.get() * (1 - falling), transform: [] };
    return {
      opacity: reprint.get() * (1 - Math.max(0, falling - 0.75) / 0.25),
      transformOrigin: side > 0 ? "100% 0%" : "0% 0%",
      transform: [
        { translateX: side * (progress.get() * 6 + falling * 70) },
        { translateY: falling * 760 - (1 - reprint.get()) * 34 },
        { rotate: `${-side * (progress.get() * 7 + falling * 34)}deg` },
      ],
    };
  });

  function onAccessibilityAction(event: AccessibilityActionEvent) {
    if (event.nativeEvent.actionName === "activate") tearOff();
  }

  return (
    <Animated.View
      style={[{ width: "100%", maxWidth: 340, zIndex: 10 }, ticketStyle]}
      onLayout={(event) => tearWidth.set(event.nativeEvent.layout.width * 0.7)}
    >
      <View style={{ zIndex: 2 }}>
        <View
          className="overflow-hidden"
          style={{ borderTopLeftRadius: 22, borderTopRightRadius: 22, borderCurve: "continuous" }}
        >
          <View style={{ minHeight: 236, padding: 22, gap: 18, justifyContent: "space-between" }}>
            <ListingGradient name="OpenBot guest pass night" />
            <View className="flex-row items-center justify-between gap-3">
              <Typography
                weight="semibold"
                style={{ color: "#ffffff", fontSize: 11, letterSpacing: 2.4, textTransform: "uppercase" }}
              >
                {t("mobile.settings.invite.pass")}
              </Typography>
              <Typography
                weight="semibold"
                numberOfLines={1}
                style={{ color: "rgba(255,255,255,0.8)", fontSize: 11, flexShrink: 1, textTransform: "uppercase" }}
              >
                {t("mobile.settings.invite.from", { name: fromName })}
              </Typography>
            </View>
            <Typography weight="bold" style={{ color: "#ffffff", fontSize: 32, lineHeight: 34, letterSpacing: -0.8 }}>
              {t("mobile.settings.invite.headline")}
            </Typography>
            <View className="flex-row gap-3">
              <PerkField label={t("mobile.settings.invite.perk.friendLabel")} value={friendPerk} />
              <PerkField label={t("mobile.settings.invite.perk.youLabel")} value={youPerk} />
            </View>
          </View>
        </View>
        <TornEdge edge="bottom" />
      </View>
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[
            {
              zIndex: 1,
              backgroundColor: PAPER,
              borderBottomLeftRadius: 22,
              borderBottomRightRadius: 22,
              borderCurve: "continuous",
            },
            stubStyle,
          ]}
          accessible
          accessibilityRole="button"
          accessibilityLabel={t("mobile.settings.invite.stub")}
          accessibilityHint={t("mobile.settings.invite.stubHint")}
          accessibilityState={{ disabled: !ready }}
          accessibilityActions={[{ name: "activate" }]}
          onAccessibilityAction={onAccessibilityAction}
        >
          <TornEdge edge="top" transparent />
          <View
            className="flex-row items-center justify-between gap-3"
            style={{ paddingHorizontal: 22, paddingTop: 8, paddingBottom: 18 }}
          >
            <View className="flex-1 gap-0.5">
              <Typography
                weight="semibold"
                style={{ color: INK, fontSize: 11, letterSpacing: 2, textTransform: "uppercase" }}
              >
                {t("mobile.settings.invite.admit")}
              </Typography>
              <Typography weight="semibold" numberOfLines={1} style={{ color: INK, fontSize: 16 }}>
                {linkLabel}
              </Typography>
              <Typography style={{ color: INK_MUTED, fontSize: 12, marginTop: 2 }}>
                {t("mobile.settings.invite.tearHint")}
              </Typography>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("mobile.settings.invite.copy")}
              accessibilityState={{ disabled: !ready }}
              disabled={!ready}
              onPress={onCopy}
              hitSlop={8}
              className="size-10 items-center justify-center rounded-full active:opacity-70"
              style={{ backgroundColor: "rgba(29,24,34,0.08)", opacity: ready ? 1 : 0.4 }}
            >
              <Copy size={18} color={INK} />
            </Pressable>
          </View>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

function PerkField({ label, value }: { label: string; value: string }) {
  return (
    <View
      className="flex-1 gap-0.5"
      style={{ backgroundColor: "rgba(255,255,255,0.16)", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 }}
    >
      <Typography
        numberOfLines={1}
        style={{ color: "rgba(255,255,255,0.75)", fontSize: 10.5, letterSpacing: 1.4, textTransform: "uppercase" }}
      >
        {label}
      </Typography>
      <Typography weight="bold" numberOfLines={1} adjustsFontSizeToFit style={{ color: "#ffffff", fontSize: 18 }}>
        {value}
      </Typography>
    </View>
  );
}

function TornEdge({ edge, transparent = false }: { edge: "top" | "bottom"; transparent?: boolean }) {
  const holeOnLine = edge === "bottom" ? { bottom: -HOLE / 2 } : { top: -HOLE / 2 };
  const notchOnLine = edge === "bottom" ? { bottom: -NOTCH / 2 } : { top: -NOTCH / 2 };
  return (
    <View style={{ height: NOTCH / 2, backgroundColor: transparent ? undefined : PAPER, overflow: "hidden" }}>
      <View
        className="flex-row justify-between"
        style={{ position: "absolute", left: NOTCH / 2 + 6, right: NOTCH / 2 + 6, ...holeOnLine }}
      >
        {HOLES.map((id) => (
          <View key={id} style={{ width: HOLE, height: HOLE, borderRadius: HOLE / 2, backgroundColor: INVITE_NIGHT }} />
        ))}
      </View>
      {(["left", "right"] as const).map((side) => (
        <View
          key={side}
          style={{
            position: "absolute",
            ...notchOnLine,
            ...(side === "left" ? { left: -NOTCH / 2 } : { right: -NOTCH / 2 }),
            width: NOTCH,
            height: NOTCH,
            borderRadius: NOTCH / 2,
            backgroundColor: INVITE_NIGHT,
          }}
        />
      ))}
    </View>
  );
}
