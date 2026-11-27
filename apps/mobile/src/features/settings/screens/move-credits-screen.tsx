import { type CreditServerWallet, creditsFromTenths, creditsMovable, creditTenths } from "@openbot/contracts/credits";
import { router, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import ArrowUpDown from "lucide-react-native/icons/arrow-up-down";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { type LayoutRectangle, Pressable, TextInput, type TextStyle, View } from "react-native";
import Animated, { cubicBezier } from "react-native-reanimated";
import { useCSSVariable } from "uniwind";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { ServerAvatar } from "@/features/servers/components/server-avatar";
import { CreditStar } from "@/features/settings/components/credit-star";
import {
  CreditBurst,
  CreditSpark,
  type CreditSparkPath,
  type CreditTileMotion,
  creditSparkDirection,
  type MotionPoint,
  useCreditTileMotion,
} from "@/features/settings/components/credit-transfer-motion";
import { SettingsContent } from "@/features/settings/components/settings-content";
import { useCreditMoveHighlight } from "@/features/settings/model/credit-move-highlight";
import { useCreditsState, useMoveCredits } from "@/features/settings/model/credits";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

const MAX_MOVE_CREDITS = 9_999_999;
const PLAIN_NUMBER = { useGrouping: false } as const satisfies Intl.NumberFormatOptions;
const STEP_CREDITS = 100;
const PRESET_SHARES = [0.1, 0.5] as const;
const MAX_AMOUNT_LENGTH = 12;
const AMOUNT_TWEEN_MS = 260;
const SWAP_TURN_MS = 280;
const EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);
const TILE_SIZE = 32;
const AMOUNT_STAR_SIZE = 26;
const AMOUNT_STAR_GAP = 8;
const AMOUNT_LINE_HEIGHT = 1.2;
const SWAP_SIZE = 44;
const SWAP_RING = 4;
const ROUTE_LABEL_WIDTH = 36;
const ROUTE_DIVIDER_INSET = 16 + ROUTE_LABEL_WIDTH + 12;
const ROUTE_BUTTON_SPACE = 16 + SWAP_SIZE + 12;
const TRANSFER_STARS = 8;
const LAUNCH_GAP_MS = 85;
const SETTLE_MS = 650;
const MINOR_KNOCK = 0.55;
const STAR_SIZE = 15;
const LAST_STAR_SIZE = 20;
const RING_INSET = -6;

type RouteSlot = "from" | "to";

interface TileLayout {
  rowY: number;
  tile: LayoutRectangle;
}

interface TransferValues {
  fromTenths: number;
  toTenths: number;
  amountTenths: number;
}

interface SparkSpec extends CreditSparkPath {
  id: number;
  size: number;
}

function sparkSpec(index: number): SparkSpec {
  return {
    id: index,
    bend: (index % 2 === 0 ? 1 : -0.35) * (40 + (index % 3) * 16),
    lift: index % 2 === 0 ? -6 : 6,
    size: index === TRANSFER_STARS - 1 ? LAST_STAR_SIZE : STAR_SIZE,
  };
}

function tileCenter(layout: TileLayout): MotionPoint {
  return { x: layout.tile.x + layout.tile.width / 2, y: layout.rowY + layout.tile.y + layout.tile.height / 2 };
}

function amountFontSize(length: number) {
  if (length > 10) return 30;
  if (length > 8) return 34;
  if (length > 6) return 42;
  return 52;
}

function asciiDigits(value: string, localDigits: readonly string[]): string {
  return Array.from(value, (char) => {
    const digit = localDigits.indexOf(char);
    return digit < 0 ? char : String(digit);
  }).join("");
}

function amountFromText(value: string, decimal: string, localDigits: readonly string[]): number {
  const normalized = asciiDigits(value, localDigits).replaceAll(decimal, ".").replace(/[,٫]/g, ".");
  const [whole = "", ...fraction] = normalized.split(".");
  const wholeDigits = whole.replace(/\D/g, "");
  const tenth = fraction.join("").replace(/\D/g, "").slice(0, 1);
  const tenths = Number(wholeDigits || "0") * 10 + Number(tenth || "0");
  return creditsFromTenths(Math.min(tenths, Number.MAX_SAFE_INTEGER));
}

export function MoveCreditsScreen() {
  const { serverId } = useLocalSearchParams<{ serverId?: string }>();
  const { t } = useText();
  const credits = useCreditsState();
  const wallet = credits.data?.servers.find((candidate) => candidate.serverId === serverId);
  if (!credits.data || !wallet || wallet.role !== "owner") {
    return (
      <SettingsContent>
        <Typography.Paragraph align="center" className="px-4 pt-10 text-text-secondary">
          {credits.data ? t("mobile.settings.credits.move.ownerOnly") : t("mobile.settings.credits.loading")}
        </Typography.Paragraph>
      </SettingsContent>
    );
  }
  return <MoveCreditsForm personal={credits.data.balance} movable={creditsMovable(credits.data)} wallet={wallet} />;
}

function MoveCreditsForm({
  personal,
  movable,
  wallet,
}: {
  personal: number;
  movable: number;
  wallet: CreditServerWallet;
}) {
  const { t, format, errorMessage } = useText();
  const move = useMoveCredits();
  const reducedMotion = useReducedMotion();
  const server = useMobileWorkspaceSelector((current) => current.servers.find((item) => item.id === wallet.serverId));
  const [foreground, muted, danger, grouped, starFill] = useCSSVariable([
    "--openbot-text-primary",
    "--openbot-text-grouped-secondary",
    "--openbot-danger-text",
    "--openbot-bg-grouped",
    "--openbot-credit-star-fill",
  ]);
  const [toServer, setToServer] = useState(() => movable > 0 || wallet.balance <= 0);
  const [turns, setTurns] = useState(0);
  const [text, setText] = useState("");
  const [transfer, setTransfer] = useState<TransferValues | null>(null);
  const [sparks, setSparks] = useState<SparkSpec[]>([]);
  const [burstAt, setBurstAt] = useState<MotionPoint | null>(null);
  const fromMotion = useCreditTileMotion();
  const toMotion = useCreditTileMotion();
  const tween = useRef<number | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const chunks = useRef<number[]>([]);
  const submitting = useRef(false);
  const before = useRef({ personal, server: wallet.balance });
  const showHighlight = useCreditMoveHighlight((state) => state.show);
  const layouts = useRef<Record<RouteSlot, TileLayout>>({
    from: { rowY: 0, tile: { x: 0, y: 0, width: 0, height: 0 } },
    to: { rowY: 0, tile: { x: 0, y: 0, width: 0, height: 0 } },
  });
  useEffect(
    () => () => {
      if (tween.current !== null) cancelAnimationFrame(tween.current);
      for (const timer of timers.current) clearTimeout(timer);
    },
    [],
  );
  const sample = format.number(1.5);
  const decimal = sample.length === 3 ? (sample[1] ?? ".") : ".";
  const localDigits = Array.from({ length: 10 }, (_, digit) => format.number(digit));
  const amount = amountFromText(text, decimal, localDigits);
  const shownText = transfer
    ? transfer.amountTenths > 0
      ? format.number(creditsFromTenths(transfer.amountTenths))
      : ""
    : text;
  const amountFont = amountFontSize(shownText.length);
  const amountStyle: TextStyle = {
    fontSize: amountFont,
    lineHeight: Math.round(amountFont * AMOUNT_LINE_HEIGHT),
    fontVariant: ["tabular-nums"],
  };
  const source = toServer ? movable : wallet.balance;
  const limit = Math.min(source, MAX_MOVE_CREDITS);
  const tooMuch = !transfer && creditTenths(amount) > creditTenths(source);
  const ready = amount > 0 && !tooMuch;
  const amountColor = String(tooMuch ? danger : foreground);
  const pending = move.isPending || transfer !== null;
  const personalShown = transfer ? creditsFromTenths(toServer ? transfer.fromTenths : transfer.toTenths) : personal;
  const serverShown = transfer ? creditsFromTenths(toServer ? transfer.toTenths : transfer.fromTenths) : wallet.balance;
  const keptTenths = creditTenths(personal) - creditTenths(movable);
  const sourceText = format.number(
    toServer ? creditsFromTenths(creditTenths(personalShown) - keptTenths) : serverShown,
  );
  const status =
    !tooMuch || (toServer && keptTenths > 0)
      ? t("mobile.settings.credits.move.available", { amount: sourceText })
      : toServer
        ? t("mobile.settings.credits.move.youHave", { count: source, amount: sourceText })
        : t("mobile.settings.credits.move.serverHas", { count: source, amount: sourceText, name: wallet.name });

  const stopTween = () => {
    if (tween.current === null) return;
    cancelAnimationFrame(tween.current);
    tween.current = null;
  };
  const animateTo = (target: number) => {
    stopTween();
    void haptics.selection();
    const startTenths = creditTenths(amount);
    const endTenths = creditTenths(Math.min(Math.max(target, 0), MAX_MOVE_CREDITS));
    if (reducedMotion || startTenths === endTenths) {
      setText(endTenths === 0 ? "" : format.number(creditsFromTenths(endTenths), PLAIN_NUMBER));
      return;
    }
    const startedAt = performance.now();
    const step = () => {
      const progress = Math.min(1, (performance.now() - startedAt) / AMOUNT_TWEEN_MS);
      const eased = 1 - (1 - progress) ** 3;
      const tenths = progress < 1 ? Math.round((startTenths + (endTenths - startTenths) * eased) / 10) * 10 : endTenths;
      setText(tenths === 0 && progress === 1 ? "" : format.number(creditsFromTenths(tenths), PLAIN_NUMBER));
      tween.current = progress < 1 ? requestAnimationFrame(step) : null;
    };
    tween.current = requestAnimationFrame(step);
  };
  const changeText = (value: string) => {
    stopTween();
    const typed = value.slice(0, MAX_AMOUNT_LENGTH);
    if (amountFromText(typed, decimal, localDigits) > MAX_MOVE_CREDITS) {
      setText(format.number(MAX_MOVE_CREDITS, PLAIN_NUMBER));
      return;
    }
    setText(typed);
  };
  const later = (delay: number, run: () => void) => {
    timers.current.push(setTimeout(run, delay));
  };
  const finish = () => {
    void haptics.notification("success");
    showHighlight({
      serverId: wallet.serverId,
      personalFrom: before.current.personal,
      serverFrom: before.current.server,
    });
    router.back();
  };
  const land = (spark: SparkSpec) => {
    const last = spark.id === TRANSFER_STARS - 1;
    const from = tileCenter(layouts.current.from);
    const to = tileCenter(layouts.current.to);
    setSparks((current) => current.filter((item) => item.id !== spark.id));
    setTransfer((current) => current && { ...current, toTenths: current.toTenths + (chunks.current[spark.id] ?? 0) });
    toMotion.knock(creditSparkDirection(from, to, spark), last ? 1 : MINOR_KNOCK);
    if (!last) {
      void haptics.impact("light");
      return;
    }
    toMotion.ring();
    setBurstAt(to);
    later(SETTLE_MS, finish);
  };
  const playTransfer = (amountTenths: number) => {
    const share = Math.floor(amountTenths / TRANSFER_STARS);
    chunks.current = Array.from({ length: TRANSFER_STARS }, (_, index) =>
      index === TRANSFER_STARS - 1 ? amountTenths - share * (TRANSFER_STARS - 1) : share,
    );
    chunks.current.forEach((value, index) => {
      later(index * LAUNCH_GAP_MS, () => {
        setTransfer(
          (current) =>
            current && {
              ...current,
              fromTenths: current.fromTenths - value,
              amountTenths: current.amountTenths - value,
            },
        );
        fromMotion.recoil();
        setSparks((current) => [...current, sparkSpec(index)]);
      });
    });
  };
  const submit = () => {
    if (!ready || pending || submitting.current) return;
    submitting.current = true;
    stopTween();
    const amountTenths = creditTenths(amount);
    before.current = { personal, server: wallet.balance };
    setTransfer({
      fromTenths: creditTenths(toServer ? personal : wallet.balance),
      toTenths: creditTenths(toServer ? wallet.balance : personal),
      amountTenths,
    });
    if (!reducedMotion) fromMotion.charge(true);
    move.mutate(
      { serverId: wallet.serverId, direction: toServer ? "to_server" : "to_personal", credits: amount },
      {
        onSuccess: () => {
          fromMotion.charge(false);
          if (reducedMotion) {
            finish();
            return;
          }
          playTransfer(amountTenths);
        },
        onError: (error) => {
          submitting.current = false;
          fromMotion.charge(false);
          setTransfer(null);
          void haptics.notification("error");
          showFailureAlert(
            error,
            "settings",
            t("mobile.settings.credits.move.failed"),
            errorMessage(error, t("mobile.settings.credits.move.failed")),
          );
        },
      },
    );
  };

  const yours = {
    tile: (
      <View
        className="items-center justify-center rounded-[10px] bg-control"
        style={{ height: TILE_SIZE, width: TILE_SIZE }}
      >
        <CreditStar size={18} />
      </View>
    ),
    name: t("mobile.settings.credits.yours"),
    balance: t("mobile.settings.credits.amount", { count: personalShown, amount: format.number(personalShown) }),
  };
  const theirs = {
    tile: server ? (
      <ServerAvatar server={server} size={TILE_SIZE} showStatus={false} />
    ) : (
      <View className="rounded-[10px] bg-control" style={{ height: TILE_SIZE, width: TILE_SIZE }} />
    ),
    name: wallet.name,
    balance: t("mobile.settings.credits.amount", { count: serverShown, amount: format.number(serverShown) }),
  };
  const from = toServer ? yours : theirs;
  const to = toServer ? theirs : yours;

  return (
    <>
      <SheetSaveAction
        dirty={amount > 0 || pending}
        canSave={ready}
        pending={pending}
        label={t("mobile.settings.credits.move.action")}
        pendingLabel={t("mobile.settings.credits.move.moving")}
        onSave={submit}
      />
      <SettingsContent>
        <View className="items-center gap-3 pt-2">
          <View className="w-full flex-row items-center justify-between gap-2">
            <StepButton
              label={t("mobile.settings.credits.move.less", { amount: format.number(STEP_CREDITS) })}
              accessibilityLabel={t("mobile.settings.credits.move.lessLabel", { amount: format.number(STEP_CREDITS) })}
              disabled={pending || amount <= 0}
              onPress={() => animateTo(Math.min(amount, limit) - STEP_CREDITS)}
            />
            <View className="min-w-0 flex-1 justify-center">
              <View
                pointerEvents="none"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                className="absolute inset-0 flex-row items-center justify-center"
                style={{ gap: AMOUNT_STAR_GAP }}
              >
                <CreditStar size={AMOUNT_STAR_SIZE} />
                <Typography
                  numberOfLines={1}
                  className="font-sans font-bold"
                  style={[
                    amountStyle,
                    { color: shownText === "" ? String(muted) : isAndroid ? "transparent" : amountColor },
                  ]}
                >
                  {shownText || format.number(0)}
                </Typography>
              </View>
              <TextInput
                value={shownText}
                onChangeText={changeText}
                onSubmitEditing={submit}
                accessibilityLabel={t("mobile.settings.credits.move.amount")}
                accessibilityHint={status}
                keyboardType="decimal-pad"
                editable={!pending}
                textAlign="center"
                selectionColor={String(foreground)}
                className="w-full font-sans font-bold"
                style={[
                  amountStyle,
                  {
                    color: isAndroid ? amountColor : "transparent",
                    paddingVertical: 4,
                    paddingLeft: AMOUNT_STAR_SIZE + AMOUNT_STAR_GAP,
                    paddingRight: 0,
                  },
                ]}
              />
            </View>
            <StepButton
              label={t("mobile.settings.credits.move.more", { amount: format.number(STEP_CREDITS) })}
              accessibilityLabel={t("mobile.settings.credits.move.moreLabel", { amount: format.number(STEP_CREDITS) })}
              disabled={pending || creditTenths(amount) >= creditTenths(limit)}
              onPress={() => animateTo(Math.min(amount + STEP_CREDITS, limit))}
            />
          </View>
          <Typography.Paragraph
            accessibilityLiveRegion="polite"
            className={tooMuch ? "text-danger-text" : "text-grouped-secondary"}
          >
            {status}
          </Typography.Paragraph>
          <View className="flex-row gap-2">
            {PRESET_SHARES.map((share) => (
              <Chip
                key={share}
                label={format.number(share, { style: "percent" })}
                disabled={pending || limit <= 0}
                onPress={() => animateTo(creditsFromTenths(Math.floor(creditTenths(limit) * share)))}
              />
            ))}
            <Chip
              label={t("mobile.settings.credits.move.all")}
              disabled={pending || limit <= 0}
              onPress={() => animateTo(limit)}
            />
          </View>
        </View>

        <View className="gap-2">
          <Typography type="body-xs" className="px-4 text-grouped-secondary">
            {t("mobile.settings.credits.move.route")}
          </Typography>
          <View className="rounded-grouped bg-grouped">
            <RouteRow
              label={t("mobile.settings.credits.move.from")}
              {...from}
              tileStyle={fromMotion.style}
              onLayout={(rowY, tile) => {
                layouts.current.from = { rowY, tile };
              }}
            />
            <View className="h-px bg-grouped-border" style={{ marginLeft: ROUTE_DIVIDER_INSET }} />
            <RouteRow
              label={t("mobile.settings.credits.move.to")}
              {...to}
              tileStyle={toMotion.style}
              ring={{ style: toMotion.ringStyle, color: String(starFill) }}
              onLayout={(rowY, tile) => {
                layouts.current.to = { rowY, tile };
              }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("mobile.settings.credits.move.swap")}
              disabled={pending}
              hitSlop={4}
              className="absolute right-4 items-center justify-center rounded-full bg-control"
              style={({ pressed }) => ({
                top: "50%",
                marginTop: -SWAP_SIZE / 2,
                height: SWAP_SIZE,
                width: SWAP_SIZE,
                borderWidth: SWAP_RING,
                borderColor: String(grouped),
                opacity: pressed ? 0.6 : 1,
              })}
              onPress={() => {
                stopTween();
                void haptics.selection();
                setToServer((current) => !current);
                setTurns((current) => current + 1);
              }}
            >
              <Animated.View
                style={{
                  transform: [{ rotate: `${turns * 180}deg` }],
                  transitionProperty: "transform",
                  transitionDuration: reducedMotion ? 0 : SWAP_TURN_MS,
                  transitionTimingFunction: EASE_OUT,
                }}
              >
                <ArrowUpDown color={String(foreground)} size={18} strokeWidth={1.9} />
              </Animated.View>
            </Pressable>
            <View pointerEvents="none" className="absolute inset-0">
              {sparks.map((spark) => (
                <CreditSpark
                  key={spark.id}
                  from={tileCenter(layouts.current.from)}
                  to={tileCenter(layouts.current.to)}
                  path={spark}
                  size={spark.size}
                  onLand={() => land(spark)}
                />
              ))}
              {burstAt ? <CreditBurst center={burstAt} color={String(starFill)} /> : null}
            </View>
          </View>
          <Typography.Paragraph type="body-xs" className="px-4 text-grouped-secondary">
            {t("mobile.settings.credits.move.footer")}
          </Typography.Paragraph>
        </View>
      </SettingsContent>
    </>
  );
}

function RouteRow({
  label,
  tile,
  name,
  balance,
  tileStyle,
  ring,
  onLayout,
}: {
  label: string;
  tile: ReactNode;
  name: string;
  balance: string;
  tileStyle: CreditTileMotion["style"];
  ring?: { style: CreditTileMotion["ringStyle"]; color: string };
  onLayout: (rowY: number, tile: LayoutRectangle) => void;
}) {
  const rowY = useRef(0);
  const tileFrame = useRef<LayoutRectangle>({ x: 0, y: 0, width: 0, height: 0 });
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${name}, ${balance}`}
      className="min-h-16 flex-row items-center gap-3 py-3 pl-4"
      style={{ paddingRight: ROUTE_BUTTON_SPACE }}
      onLayout={(event) => {
        rowY.current = event.nativeEvent.layout.y;
        onLayout(rowY.current, tileFrame.current);
      }}
    >
      <Typography type="body-xs" className="text-grouped-secondary" style={{ width: ROUTE_LABEL_WIDTH }}>
        {label}
      </Typography>
      <Animated.View
        style={tileStyle}
        onLayout={(event) => {
          tileFrame.current = event.nativeEvent.layout;
          onLayout(rowY.current, tileFrame.current);
        }}
      >
        {tile}
        {ring ? (
          <Animated.View
            pointerEvents="none"
            className="absolute rounded-[14px] border-2"
            style={[
              { top: RING_INSET, left: RING_INSET, right: RING_INSET, bottom: RING_INSET, borderColor: ring.color },
              ring.style,
            ]}
          />
        ) : null}
      </Animated.View>
      <View className="min-w-0 flex-1">
        <Typography.Paragraph numberOfLines={1}>{name}</Typography.Paragraph>
        <Typography.Paragraph type="body-xs" numberOfLines={1} className="text-grouped-secondary">
          {balance}
        </Typography.Paragraph>
      </View>
    </View>
  );
}

function Chip({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      className="h-9 items-center justify-center rounded-full bg-grouped px-4"
      style={({ pressed }) => ({ opacity: disabled ? 0.4 : 1, transform: [{ scale: pressed ? 0.95 : 1 }] })}
      onPress={onPress}
    >
      <Typography.Paragraph className="font-medium" style={typeScale.preview}>
        {label}
      </Typography.Paragraph>
    </Pressable>
  );
}

function StepButton({
  label,
  accessibilityLabel,
  disabled,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      className="h-11 min-w-14 items-center justify-center rounded-full bg-grouped px-3"
      style={({ pressed }) => ({ opacity: disabled ? 0.4 : 1, transform: [{ scale: pressed ? 0.94 : 1 }] })}
      onPress={onPress}
    >
      <Typography.Paragraph className="font-semibold" style={typeScale.caption}>
        {label}
      </Typography.Paragraph>
    </Pressable>
  );
}
