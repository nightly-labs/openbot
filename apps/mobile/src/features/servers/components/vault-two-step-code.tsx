// The live two-step code of a Vault login, as an authenticator app shows it: the digits in two groups
// and a ring that empties until the next code. A tap copies the code.

import { groupedTwoStepCode } from "@openbot/contracts/two-step-code";
import * as Clipboard from "expo-clipboard";
import { Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import Copy from "lucide-react-native/icons/copy";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  ReduceMotion,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, G } from "react-native-svg";
import { useCSSVariable } from "uniwind";
import { type LiveTwoStepCode, secondsLeft } from "@/features/servers/model/vault-two-step";
import { SettingsRow } from "@/features/settings/components/settings-content";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { useText } from "@/shared/lib/text";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
/** From this many seconds left, the ring and the digits take the warning color. */
const WARNING_SECONDS = 5;
/** How long Copy shows its check mark, as the chat Copy does. */
const COPIED_MS = 1_400;

/** Copies a code, with a check mark for a short time and a haptic. */
export function useCopyTwoStepCode() {
  const [copied, setCopied] = useState(false);
  const reset = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(reset.current), []);
  const copy = async (code: string) => {
    try {
      await Clipboard.setStringAsync(code);
      setCopied(true);
      clearTimeout(reset.current);
      reset.current = setTimeout(() => setCopied(false), COPIED_MS);
      void haptics.notification("success");
    } catch {
      void haptics.notification("error");
    }
  };
  return { copy, copied };
}

/**
 * The time until the next code, as a ring that empties. It moves smoothly from the last tick; with
 * reduced motion it steps once a second.
 */
function TwoStepTimer({
  code,
  now,
  size = 18,
  stroke = 2.5,
}: {
  code: LiveTwoStepCode;
  now: number;
  size?: number;
  stroke?: number;
}) {
  const reducedMotion = useReducedMotion();
  const accent = String(useCSSVariable("--openbot-accent"));
  const warning = String(useCSSVariable("--openbot-warning"));
  const track = String(useCSSVariable("--openbot-border-grouped"));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const periodMs = code.period * 1000;
  const remaining = Math.max(0, code.expiresAt - now);
  const fraction = useSharedValue(Math.min(1, remaining / periodMs));
  // With reduced motion the ring steps at each tick of `now`.
  const tick = reducedMotion ? now : 0;
  useEffect(() => {
    const left = Math.max(0, code.expiresAt - Date.now());
    fraction.set(Math.min(1, left / periodMs));
    // From the current time the ring runs down to empty at the end of the code, at an even speed.
    if (!reducedMotion && tick === 0)
      fraction.set(withTiming(0, { duration: left, easing: Easing.linear, reduceMotion: ReduceMotion.Never }));
  }, [code.expiresAt, fraction, periodMs, reducedMotion, tick]);
  const props = useAnimatedProps(() => ({ strokeDashoffset: circumference * (1 - fraction.get()) }));
  const color = secondsLeft(code, now) <= WARNING_SECONDS ? warning : accent;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size}>
        <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
          <Circle cx={size / 2} cy={size / 2} r={radius} stroke={track} strokeWidth={stroke} fill="none" />
          <AnimatedCircle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${circumference} ${circumference}`}
            fill="none"
            animatedProps={props}
          />
        </G>
      </Svg>
    </View>
  );
}

const DIGIT_SIZES = {
  body: { className: "text-body", letterSpacing: 0.5 },
  title: { className: "text-title", letterSpacing: 1.5 },
  display: { className: "text-display", letterSpacing: 2 },
  hero: { className: "text-[44px] leading-[52px]", letterSpacing: 4 },
} as const;

/** The digits of a code in two groups. A new code fades in. */
function TwoStepDigits({
  code,
  now,
  size = "body",
}: {
  code: LiveTwoStepCode;
  now: number;
  size?: keyof typeof DIGIT_SIZES;
}) {
  const warning = secondsLeft(code, now) <= WARNING_SECONDS;
  const digits = DIGIT_SIZES[size];
  return (
    <Animated.View key={code.code} entering={FadeIn.duration(180).reduceMotion(ReduceMotion.System)}>
      <Typography.Paragraph
        numberOfLines={1}
        className={`font-semibold tabular-nums ${digits.className} ${warning ? "text-warning-text" : "text-accent-text"}`}
        style={{ letterSpacing: digits.letterSpacing }}
      >
        {groupedTwoStepCode(code.code)}
      </Typography.Paragraph>
    </Animated.View>
  );
}

/** The live code at the end of a Vault list row. A tap copies it; the rest of the row opens the login. */
export function TwoStepRowCode({ code, now, site }: { code: LiveTwoStepCode; now: number; site: string }) {
  const { t } = useText();
  const { copy, copied } = useCopyTwoStepCode();
  const success = String(useCSSVariable("--openbot-success-text"));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("mobile.server.vault.twoStep.copyFor", { site, code: groupedTwoStepCode(code.code) })}
      hitSlop={8}
      onPress={() => void copy(code.code)}
      className="flex-row items-center gap-2 rounded-full py-1 ps-2"
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <TwoStepDigits code={code} now={now} />
      <View className="size-[18px] items-center justify-center">
        {copied ? <Check size={16} strokeWidth={2.4} color={success} /> : <TwoStepTimer code={code} now={now} />}
      </View>
    </Pressable>
  );
}

/**
 * The current code in very large digits with its ring, for the check step. The whole card copies the
 * code. Undefined shows a placeholder.
 */
export function TwoStepCodePanel({
  code,
  now,
  caption,
}: {
  code: LiveTwoStepCode | undefined;
  now: number;
  caption?: string | undefined;
}) {
  const { t } = useText();
  const { copy, copied } = useCopyTwoStepCode();
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const success = String(useCSSVariable("--openbot-success-text"));
  const label = code
    ? `${t("mobile.server.vault.twoStep.codeLabel", {
        code: groupedTwoStepCode(code.code),
      })} ${t("mobile.server.vault.twoStep.copy")}`
    : (caption ?? t("mobile.server.vault.twoStep.codeLoading"));
  return (
    <Pressable
      accessibilityRole={code ? "button" : undefined}
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      disabled={!code}
      onPress={code ? () => void copy(code.code) : undefined}
      className="items-center gap-4 px-4 pb-6 pt-7"
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      {code ? (
        <TwoStepDigits code={code} now={now} size="hero" />
      ) : (
        <Typography.Paragraph className="text-[44px] font-semibold leading-[52px] tabular-nums text-grouped-secondary">
          {"––– –––"}
        </Typography.Paragraph>
      )}
      {code ? (
        <View className="flex-row items-center gap-3">
          <TwoStepTimer code={code} now={now} size={18} stroke={2.5} />
          <View className="h-4 w-px bg-border" />
          <View className="flex-row items-center gap-1.5">
            {copied ? (
              <Check size={15} strokeWidth={2.4} color={success} />
            ) : (
              <Copy size={15} strokeWidth={2} color={muted} />
            )}
            <Typography.Paragraph type="body-sm" className={copied ? "text-success-text" : "text-grouped-secondary"}>
              {copied ? t("mobile.server.vault.twoStep.copied") : t("mobile.server.vault.twoStep.copy")}
            </Typography.Paragraph>
          </View>
        </View>
      ) : caption ? (
        <Typography.Paragraph type="body-xs" align="center" className="text-grouped-secondary">
          {caption}
        </Typography.Paragraph>
      ) : null}
    </Pressable>
  );
}

/**
 * The current code as a row of a login page: the digits, a Copy caption and the ring. A tap copies
 * the code. Undefined shows a placeholder and `caption`, such as a failed load.
 */
export function TwoStepCodeRow({
  code,
  now,
  caption,
}: {
  code: LiveTwoStepCode | undefined;
  now: number;
  caption?: string | undefined;
}) {
  const { t } = useText();
  const { copy, copied } = useCopyTwoStepCode();
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const success = String(useCSSVariable("--openbot-success-text"));
  if (!code)
    return (
      <SettingsRow
        disclosure={false}
        accessibilityLabel={caption ?? t("mobile.server.vault.twoStep.codeLoading")}
        supportingText={caption}
      >
        <Typography.Paragraph className="text-title font-semibold tabular-nums text-grouped-secondary">
          {"––– –––"}
        </Typography.Paragraph>
      </SettingsRow>
    );
  return (
    <SettingsRow
      disclosure={false}
      onPress={() => void copy(code.code)}
      accessibilityLabel={`${t("mobile.server.vault.twoStep.codeLabel", {
        code: groupedTwoStepCode(code.code),
      })} ${t("mobile.server.vault.twoStep.copy")}`}
      trailing={<TwoStepTimer code={code} now={now} size={24} stroke={3} />}
    >
      <TwoStepDigits code={code} now={now} size="title" />
      <View className="flex-row items-center gap-1">
        {copied ? (
          <Check size={13} strokeWidth={2.4} color={success} />
        ) : (
          <Copy size={13} strokeWidth={2} color={muted} />
        )}
        <Typography.Paragraph type="body-xs" className={copied ? "text-success-text" : "text-grouped-secondary"}>
          {copied ? t("mobile.server.vault.twoStep.copied") : t("mobile.server.vault.twoStep.copy")}
        </Typography.Paragraph>
      </View>
    </SettingsRow>
  );
}
