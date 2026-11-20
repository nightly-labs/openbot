import MaskedView from "@react-native-masked-view/masked-view";
import {
  Canvas,
  Group,
  Skia,
  LinearGradient as SkiaLinearGradient,
  Path as SkiaPath,
  type SkPath,
  type SkSize,
  vec,
} from "@shopify/react-native-skia";
import { Typography } from "heroui-native";
import Copy from "lucide-react-native/icons/copy";
import { useEffect, useRef } from "react";
import { type AccessibilityActionEvent, Pressable, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path as SvgPath } from "react-native-svg";
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
const ROLL = { tear: 46, fall: 34, fixed: 30, flutter: 12 } as const;
const ROLL_TAPER = 1.18;
const CANVAS_BLEED = 64;
const MASK_BLEED = 4;
const ROLL_CAP = 0.14;
const TICKET_MAX_WIDTH = 340;
const TICKET_SIDE_GUTTERS = 48;
const TEAR_SHARE = 0.7;
const ROLL_BOW = 0.08;
const ROLL_THICKNESS = 0.55;
const ROLL_SHADOW = 0.5;

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
  const { width: windowWidth } = useWindowDimensions();
  const tearWidth = useSharedValue(Math.min(TICKET_MAX_WIDTH, windowWidth - TICKET_SIDE_GUTTERS) * TEAR_SHARE);
  const paperSize = useSharedValue({ width: 0, height: 0 });
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

  const rolls = useDerivedValue((): Rolls => {
    if (reduced) return NO_ROLLS;
    const falling = fall.get();
    const flutter = Math.sin(falling * Math.PI * 3) * falling;
    const tear = progress.get();
    const free = Math.max(0, ROLL.tear * (1 - (1 - tear) * (1 - tear)) + falling * ROLL.fall + flutter * ROLL.flutter);
    const fixed = Math.max(0, falling * ROLL.fixed - flutter * ROLL.flutter * 0.6);
    return direction.get() > 0 ? { left: free, right: fixed } : { left: fixed, right: free };
  });

  function onAccessibilityAction(event: AccessibilityActionEvent) {
    if (event.nativeEvent.actionName === "activate") tearOff();
  }

  return (
    <Animated.View
      style={[{ width: "100%", maxWidth: TICKET_MAX_WIDTH, zIndex: 10 }, ticketStyle]}
      onLayout={(event) => tearWidth.set(event.nativeEvent.layout.width * TEAR_SHARE)}
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
          style={[{ zIndex: 1 }, stubStyle]}
          accessible
          accessibilityRole="button"
          accessibilityLabel={t("mobile.settings.invite.stub")}
          accessibilityHint={t("mobile.settings.invite.stubHint")}
          accessibilityState={{ disabled: !ready }}
          accessibilityActions={[{ name: "activate" }]}
          onAccessibilityAction={onAccessibilityAction}
        >
          <MaskedView maskElement={<StubMask rolls={rolls} size={paperSize} />}>
            <View
              style={STUB_PAPER}
              onLayout={(event) => {
                const { width, height } = event.nativeEvent.layout;
                paperSize.set({ width, height });
              }}
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
            </View>
          </MaskedView>
          <SideRolls rolls={rolls} size={paperSize} />
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

type Side = "left" | "right";
type Rolls = Record<Side, number>;

const NO_ROLLS: Rolls = { left: 0, right: 0 };
const SIDES: readonly Side[] = ["left", "right"];
const ROLL_COLORS = ["#b9ad99", "#e6ddcf", "#fffdf8", "#ebe3d5", "#cdc1ae", "#a89b86"];
const ROLL_STOPS = [0, 0.16, 0.42, 0.78, 0.94, 1];
const ROLL_SHADOW_COLORS = ["rgba(42,30,18,0.3)", "rgba(42,30,18,0)"];
const ROLL_LAYER = {
  position: "absolute",
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
} as const;
const ROLL_CANVAS = {
  position: "absolute",
  top: -CANVAS_BLEED,
  right: -CANVAS_BLEED,
  bottom: -CANVAS_BLEED,
  left: -CANVAS_BLEED,
} as const;
const MASK_LAYER = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } as const;
const STUB_PAPER = {
  backgroundColor: PAPER,
  borderBottomLeftRadius: 22,
  borderBottomRightRadius: 22,
  borderCurve: "continuous",
} as const;
const AnimatedSvgPath = Animated.createAnimatedComponent(SvgPath);
const ROLL_CANVAS_SHIFT = [{ translateX: CANVAS_BLEED }, { translateY: CANVAS_BLEED }];

function rollGeometry(side: Side, roll: number, width: number, height: number) {
  "worklet";
  const at = (x: number) => (side === "right" ? width - x : x);
  const top = roll * ROLL_TAPER;
  const bottom = roll * (2 - ROLL_TAPER);
  const crease = (top + bottom) / 2 + roll * ROLL_BOW;
  const topLip = top + top * ROLL_THICKNESS;
  const bottomLip = bottom + bottom * ROLL_THICKNESS;
  const lip = crease + roll * ROLL_THICKNESS;
  const reach = roll * ROLL_SHADOW + 3;
  const middle = height / 2;
  const cap = roll * ROLL_CAP;
  const outer = Math.max(topLip, bottomLip, lip);
  return {
    roll: `M${at(top)} 0 Q${at((top + topLip) / 2)} ${-cap} ${at(topLip)} 0 Q${at(lip)} ${middle} ${at(bottomLip)} ${height} Q${at((bottom + bottomLip) / 2)} ${height + cap} ${at(bottom)} ${height} Q${at(crease)} ${middle} ${at(top)} 0 Z`,
    shadow: `M${at(topLip)} 0 L${at(topLip + reach)} 0 Q${at(lip + reach)} ${middle} ${at(bottomLip + reach)} ${height} L${at(bottomLip)} ${height} Q${at(lip)} ${middle} ${at(topLip)} 0 Z`,
    rollStart: at(Math.min(top, bottom)),
    rollEnd: at(outer),
    shadowStart: at(outer),
    shadowEnd: at(outer + reach),
  };
}

function svgPath(path: string): SkPath {
  "worklet";
  return Skia.Path.MakeFromSVGString(path) ?? Skia.Path.Make();
}

function SideRolls({ rolls, size }: { rolls: SharedValue<Rolls>; size: SharedValue<SkSize> }) {
  return (
    <View pointerEvents="none" style={ROLL_LAYER}>
      <Canvas style={ROLL_CANVAS}>
        {SIDES.map((side) => (
          <SideRoll key={side} side={side} rolls={rolls} size={size} />
        ))}
      </Canvas>
    </View>
  );
}

function paperMask(rolls: Rolls, size: SkSize, bleed: number): string {
  "worklet";
  const { width, height } = size;
  if (width <= 0 || height <= 0) return `M${-bleed} ${-bleed} H${bleed * 1000} V${bleed * 1000} H${-bleed} Z`;
  const edge = (roll: number) => {
    if (roll <= 0) return { top: -bleed, bottom: -bleed, crease: -bleed };
    const top = roll * ROLL_TAPER;
    const bottom = roll * (2 - ROLL_TAPER);
    return { top, bottom, crease: (top + bottom) / 2 + roll * ROLL_BOW };
  };
  const left = edge(rolls.left);
  const right = edge(rolls.right);
  const middle = height / 2;
  return `M${left.top} ${-bleed} L${width - right.top} ${-bleed} L${width - right.top} 0 Q${width - right.crease} ${middle} ${width - right.bottom} ${height} L${width - right.bottom} ${height + bleed} L${left.bottom} ${height + bleed} L${left.bottom} ${height} Q${left.crease} ${middle} ${left.top} 0 Z`;
}

function StubMask({ rolls, size }: { rolls: SharedValue<Rolls>; size: SharedValue<SkSize> }) {
  const maskProps = useAnimatedProps(() => ({ d: paperMask(rolls.get(), size.get(), MASK_BLEED) }));
  return (
    <Svg style={MASK_LAYER}>
      <AnimatedSvgPath animatedProps={maskProps} fill="#000000" />
    </Svg>
  );
}

function SideRoll({ side, rolls, size }: { side: Side; rolls: SharedValue<Rolls>; size: SharedValue<SkSize> }) {
  const geometry = useDerivedValue(() => rollGeometry(side, rolls.get()[side], size.get().width, size.get().height));
  const paper = useDerivedValue(() => svgPath(paperMask(rolls.get(), size.get(), 0)));
  const shadow = useDerivedValue(() => svgPath(geometry.get().shadow));
  const roll = useDerivedValue(() => svgPath(geometry.get().roll));
  const rollStart = useDerivedValue(() => vec(geometry.get().rollStart, 0));
  const rollEnd = useDerivedValue(() => vec(geometry.get().rollEnd, 0));
  const shadowStart = useDerivedValue(() => vec(geometry.get().shadowStart, 0));
  const shadowEnd = useDerivedValue(() => vec(geometry.get().shadowEnd, 0));
  return (
    <Group transform={ROLL_CANVAS_SHIFT}>
      <Group clip={paper}>
        <SkiaPath path={shadow}>
          <SkiaLinearGradient start={shadowStart} end={shadowEnd} colors={ROLL_SHADOW_COLORS} />
        </SkiaPath>
      </Group>
      <SkiaPath path={roll}>
        <SkiaLinearGradient start={rollStart} end={rollEnd} colors={ROLL_COLORS} positions={ROLL_STOPS} />
      </SkiaPath>
    </Group>
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
