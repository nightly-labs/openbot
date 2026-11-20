import {
  Canvas,
  FillType,
  Group,
  Rect,
  rect,
  type SkImage,
  Skia,
  Image as SkiaImage,
  Path as SkiaPath,
  type SkSize,
  useFonts,
} from "@shopify/react-native-skia";
import { Typography } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import {
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
  PixelRatio,
  type TextLayoutEvent,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import interRegular from "@/assets/fonts/inter/Inter-Regular.ttf";
import interSemiBold from "@/assets/fonts/inter/Inter-SemiBold.ttf";
import { ListingGradient } from "@/features/marketplace/components/listing-gradient";
import {
  renderInviteStubTexture,
  type StubBox,
  type StubColors,
  type StubLine,
  type StubPart,
  type StubParts,
} from "@/features/settings/model/invite-stub-texture";
import { APP_FONT } from "@/shared/lib/app-font";
import { useFontScale } from "@/shared/lib/font-scale";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { useText } from "@/shared/lib/text";

const NOTCH = 24;
const NOTCHES = 6;
const HOLE = 7;
const HOLES = Array.from({ length: 18 }, (_, index) => `hole-${index}`);
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const GRAVITY = Easing.bezier(0.45, 0, 0.9, 0.55);
const SHARE_AFTER_TEAR_MS = 260;
const BEND = { tear: 1.75, fall: 0.9, flutter: 0.45 } as const;
const BEND_START = 0.62;
const BEND_PERSPECTIVE = 720;
const BEND_COLUMNS = 32;
const STRIP_OVERLAP = 0.5;
const TICKET_SHADOW = "#2a1e4a";
const TEXTURE_SETTLE_MS = 80;
const HIDDEN_STRIP = [0, 0, 0, 0, 0, 0, 0, 0, 1];
const CANVAS_BLEED = 64;
const TICKET_MAX_WIDTH = 340;
const TICKET_SIDE_GUTTERS = 32;
const TEAR_SHARE = 0.7;

export interface InviteTicketProps {
  linkLabel: string;
  fromName: string;
  friendPerk: string;
  youPerk: string;
  ready: boolean;
  onTear: () => Promise<void>;
  surface: string;
  shadowOpacity: number;
  stub: StubColors;
}

export function InviteTicket({
  linkLabel,
  fromName,
  friendPerk,
  youPerk,
  ready,
  onTear,
  surface,
  shadowOpacity,
  stub,
}: InviteTicketProps) {
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

  const fonts = useFonts({ [APP_FONT]: [interRegular, interSemiBold] });
  const [paperLayout, setPaperLayout] = useState<{ width: number; height: number } | null>(null);
  const [stubParts, setStubParts] = useState<Partial<StubParts>>({});
  const [lineWidths, setLineWidths] = useState<Partial<Record<StubLine, number>>>({});
  const fontScale = useFontScale();
  const measureLine = (line: StubLine) => (event: TextLayoutEvent) => {
    const width = event.nativeEvent.lines[0]?.width;
    if (width === undefined) return;
    setLineWidths((previous) => (previous[line] === width ? previous : { ...previous, [line]: width }));
  };
  const measure = (part: StubPart) => (event: LayoutChangeEvent) => {
    const box = event.nativeEvent.layout;
    setStubParts((previous) => (sameBox(previous[part], box) ? previous : { ...previous, [part]: box }));
  };
  const [paperImage, setPaperImage] = useState<SkImage | null>(null);
  const imageReady = useSharedValue(0);
  const admitText = t("mobile.settings.invite.admit");
  const hintText = t("mobile.settings.invite.tearHint");

  useEffect(() => {
    if (!fonts || !paperLayout || !hasAllParts(stubParts)) return;
    const timer = setTimeout(() => {
      const image = renderInviteStubTexture({
        ...paperLayout,
        parts: stubParts,
        lineWidths,
        fontScale,
        colors: stub,
        scale: PixelRatio.get(),
        admit: admitText,
        link: linkLabel,
        hint: hintText,
        fonts,
      });
      setPaperImage(image);
      imageReady.set(image ? 1 : 0);
    }, TEXTURE_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [admitText, fontScale, fonts, hintText, imageReady, lineWidths, linkLabel, paperLayout, stub, stubParts]);

  const bend = useDerivedValue(() => {
    if (reduced) return 0;
    const falling = fall.get();
    const flutter = Math.sin(falling * Math.PI * 3) * falling;
    const tear = progress.get();
    return BEND.tear * (1 - (1 - tear) * (1 - tear)) + falling * BEND.fall + flutter * BEND.flutter;
  });
  const paperDrawn = useDerivedValue(() => imageReady.get() > 0);
  const paperStyle = useAnimatedStyle(() => ({ opacity: paperDrawn.get() ? 0 : 1 }));
  const bendStyle = useAnimatedStyle(() => ({ opacity: paperDrawn.get() ? 1 : 0 }));

  function onAccessibilityAction(event: AccessibilityActionEvent) {
    if (event.nativeEvent.actionName === "activate") tearOff();
  }

  return (
    <Animated.View
      style={[
        {
          width: "100%",
          maxWidth: TICKET_MAX_WIDTH,
          zIndex: 10,
          shadowColor: TICKET_SHADOW,
          shadowOpacity,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 12 },
        },
        ticketStyle,
      ]}
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
        <PerforatedStrip paper={stub.paper} size={paperSize} />
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
          <Animated.View style={paperStyle}>
            <View
              style={[STUB_PAPER, { backgroundColor: stub.paper }]}
              onLayout={(event) => {
                const { width, height } = event.nativeEvent.layout;
                paperSize.set({ width, height });
                setPaperLayout((previous) =>
                  previous?.width === width && previous.height === height ? previous : { width, height },
                );
              }}
            >
              <TornEdge edge="top" paper={stub.paper} hole={stub.hole ?? surface} transparent />
              <View
                className="flex-row items-center justify-between gap-3"
                style={{ paddingHorizontal: 22, paddingTop: 8, paddingBottom: 18 }}
                onLayout={measure("row")}
              >
                <View className="flex-1 gap-0.5" onLayout={measure("column")}>
                  <Typography
                    weight="semibold"
                    style={{ color: stub.ink, fontSize: 11, letterSpacing: 2, textTransform: "uppercase" }}
                    onLayout={measure("admit")}
                    onTextLayout={measureLine("admit")}
                  >
                    {t("mobile.settings.invite.admit")}
                  </Typography>
                  <Typography
                    weight="semibold"
                    numberOfLines={1}
                    style={{ color: stub.ink, fontSize: 16 }}
                    onLayout={measure("link")}
                    onTextLayout={measureLine("link")}
                  >
                    {linkLabel}
                  </Typography>
                  <Typography
                    style={{ color: stub.muted, fontSize: 12, marginTop: 2 }}
                    onLayout={measure("hint")}
                    onTextLayout={measureLine("hint")}
                  >
                    {t("mobile.settings.invite.tearHint")}
                  </Typography>
                </View>
              </View>
            </View>
          </Animated.View>
          <Animated.View pointerEvents="none" style={[BEND_LAYER, bendStyle]}>
            <PaperBend image={paperImage} bend={bend} direction={direction} size={paperSize} />
          </Animated.View>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

const BEND_LAYER = {
  position: "absolute",
  top: -CANVAS_BLEED,
  right: -CANVAS_BLEED,
  bottom: -CANVAS_BLEED,
  left: -CANVAS_BLEED,
} as const;
const STUB_PAPER = {
  borderBottomLeftRadius: 22,
  borderBottomRightRadius: 22,
  borderCurve: "continuous",
} as const;
const BEND_SHIFT = [{ translateX: CANVAS_BLEED }, { translateY: CANVAS_BLEED }];
const BEND_STRIPS = Array.from({ length: BEND_COLUMNS }, (_, index) => index);

interface BendColumn {
  x: number;
  top: number;
  bottom: number;
  shade: number;
}

function bendColumns(bend: number, side: number, width: number, height: number): BendColumn[] {
  "worklet";
  const columns: BendColumn[] = [];
  const start = width * BEND_START;
  const radius = bend > 0.001 ? start / bend : 0;
  const centerX = width / 2;
  const centerY = height / 2;
  for (let column = 0; column <= BEND_COLUMNS; column += 1) {
    const x = (column / BEND_COLUMNS) * width;
    const fromFree = side > 0 ? x : width - x;
    const arc = radius > 0 ? Math.max(0, start - fromFree) : 0;
    const angle = radius > 0 ? arc / radius : 0;
    const reach = radius > 0 ? radius * Math.sin(angle) : 0;
    const lift = radius > 0 ? radius * (1 - Math.cos(angle)) : 0;
    const flatX = arc > 0 ? (side > 0 ? start - reach : width - start + reach) : x;
    const scale = BEND_PERSPECTIVE / (BEND_PERSPECTIVE - lift);
    const light = Math.min(1, 0.82 + 0.18 * Math.cos(angle) + 0.06 * Math.sin(angle * 2));
    columns.push({
      x: centerX + (flatX - centerX) * scale,
      top: centerY - centerY * scale,
      bottom: centerY + (height - centerY) * scale,
      shade: 1 - Math.max(0.55, light),
    });
  }
  return columns;
}

function stripMatrix(from: number, step: number, height: number, left: BendColumn, right: BendColumn): number[] {
  "worklet";
  const x0 = left.x;
  const y0 = left.top;
  const x1 = right.x;
  const y1 = right.top;
  const x2 = right.x;
  const y2 = right.bottom;
  const x3 = left.x;
  const y3 = left.bottom;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  let a = x1 - x0;
  let b = x3 - x0;
  let d = y1 - y0;
  let e = y3 - y0;
  let g = 0;
  let h = 0;
  if (Math.abs(sx) > 1e-6 || Math.abs(sy) > 1e-6) {
    const dx1 = x1 - x2;
    const dx2 = x3 - x2;
    const dy1 = y1 - y2;
    const dy2 = y3 - y2;
    const den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) > 1e-9) {
      g = (sx * dy2 - dx2 * sy) / den;
      h = (dx1 * sy - sx * dy1) / den;
      a = x1 - x0 + g * x1;
      b = x3 - x0 + h * x3;
      d = y1 - y0 + g * y1;
      e = y3 - y0 + h * y3;
    }
  }
  return [
    a / step,
    b / height,
    x0 - (a * from) / step,
    d / step,
    e / height,
    y0 - (d * from) / step,
    g / step,
    h / height,
    1 - (g * from) / step,
  ];
}

function PaperBend({
  image,
  bend,
  direction,
  size,
}: {
  image: SkImage | null;
  bend: SharedValue<number>;
  direction: SharedValue<number>;
  size: SharedValue<SkSize>;
}) {
  const columns = useDerivedValue(() => bendColumns(bend.get(), direction.get(), size.get().width, size.get().height));
  if (!image) return null;
  return (
    <Canvas style={{ flex: 1 }}>
      <Group transform={BEND_SHIFT}>
        {BEND_STRIPS.map((slot) => (
          <BendStrip key={slot} slot={slot} image={image} columns={columns} direction={direction} size={size} />
        ))}
      </Group>
    </Canvas>
  );
}

function BendStrip({
  slot,
  image,
  columns,
  direction,
  size,
}: {
  slot: number;
  image: SkImage;
  columns: SharedValue<BendColumn[]>;
  direction: SharedValue<number>;
  size: SharedValue<SkSize>;
}) {
  const index = useDerivedValue(() => (direction.get() > 0 ? BEND_COLUMNS - 1 - slot : slot));
  const matrix = useDerivedValue(() => {
    const { width, height } = size.get();
    const step = width / BEND_COLUMNS;
    const strip = index.get();
    const left = columns.get()[strip];
    const right = columns.get()[strip + 1];
    if (!left || !right || step <= 0 || height <= 0) return Skia.Matrix(HIDDEN_STRIP);
    const values = stripMatrix(strip * step, step, height, left, right);
    return values.every(Number.isFinite) ? Skia.Matrix(values) : Skia.Matrix(HIDDEN_STRIP);
  });
  const clip = useDerivedValue(() => {
    const step = size.get().width / BEND_COLUMNS;
    return rect(
      index.get() * step - STRIP_OVERLAP,
      -STRIP_OVERLAP,
      step + STRIP_OVERLAP * 2,
      size.get().height + STRIP_OVERLAP * 2,
    );
  });
  const shade = useDerivedValue(() => {
    const left = columns.get()[index.get()];
    const right = columns.get()[index.get() + 1];
    return left && right ? (left.shade + right.shade) / 2 : 0;
  });
  const width = useDerivedValue(() => size.get().width);
  const height = useDerivedValue(() => size.get().height);
  return (
    <Group matrix={matrix} clip={clip}>
      <SkiaImage image={image} x={0} y={0} width={width} height={height} fit="fill" />
      <Rect x={0} y={0} width={width} height={height} color="#000000" opacity={shade} />
    </Group>
  );
}

function sameBox(previous: StubBox | undefined, next: StubBox): boolean {
  return (
    previous !== undefined &&
    previous.x === next.x &&
    previous.y === next.y &&
    previous.width === next.width &&
    previous.height === next.height
  );
}

function hasAllParts(parts: Partial<StubParts>): parts is StubParts {
  return Boolean(parts.row && parts.column && parts.admit && parts.link && parts.hint);
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

function PerforatedStrip({ paper, size }: { paper: string; size: SharedValue<SkSize> }) {
  const path = useDerivedValue(() => {
    const width = size.get().width;
    const height = NOTCH / 2;
    const builder = Skia.PathBuilder.Make();
    if (width <= 0) return builder.build();
    builder.addRect(rect(0, 0, width, height));
    builder.addCircle(0, height, NOTCH / 2);
    builder.addCircle(width, height, NOTCH / 2);
    const first = NOTCH / 2 + 6 + HOLE / 2;
    const last = width - NOTCH / 2 - 6 - HOLE / 2;
    for (let index = 0; index < HOLES.length; index += 1) {
      builder.addCircle(first + ((last - first) * index) / (HOLES.length - 1), height, HOLE / 2);
    }
    builder.setFillType(FillType.EvenOdd);
    return builder.build();
  });
  return (
    <Canvas style={{ height: NOTCH / 2 }}>
      <SkiaPath path={path} color={paper} />
    </Canvas>
  );
}

function TornEdge({
  edge,
  paper,
  hole,
  transparent = false,
}: {
  edge: "top" | "bottom";
  paper: string;
  hole: string;
  transparent?: boolean;
}) {
  const holeOnLine = edge === "bottom" ? { bottom: -HOLE / 2 } : { top: -HOLE / 2 };
  const notchOnLine = edge === "bottom" ? { bottom: -NOTCH / 2 } : { top: -NOTCH / 2 };
  return (
    <View style={{ height: NOTCH / 2, backgroundColor: transparent ? undefined : paper, overflow: "hidden" }}>
      <View
        className="flex-row justify-between"
        style={{ position: "absolute", left: NOTCH / 2 + 6, right: NOTCH / 2 + 6, ...holeOnLine }}
      >
        {HOLES.map((id) => (
          <View key={id} style={{ width: HOLE, height: HOLE, borderRadius: HOLE / 2, backgroundColor: hole }} />
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
            backgroundColor: hole,
          }}
        />
      ))}
    </View>
  );
}
