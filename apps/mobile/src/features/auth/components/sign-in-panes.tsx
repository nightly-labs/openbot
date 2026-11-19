import { ONE_TIME_CODE_LENGTH } from "@openbot/contracts/validation";
import { Button, Spinner, Typography } from "heroui-native";
import type { LucideIcon } from "lucide-react-native";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ScanLine from "lucide-react-native/icons/scan-line";
import { type ReactNode, type Ref, useEffect } from "react";
import { Pressable, type TextInputInstance, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { EmailCodeInput, type EmailCodeInputHandle } from "@/features/auth/components/email-code-input";
import { EmailField } from "@/features/auth/components/email-field";
import { SIGN_IN_CONTROL_HEIGHT, useSignInColors } from "@/features/auth/components/sign-in-colors";
import {
  PANE_STAGGER_MS,
  type PaneDirection,
  paneEnter,
  SIGN_IN_EASE_OUT,
  SIGN_IN_TEXT_EASE,
  signInMotion,
} from "@/features/auth/components/sign-in-motion";
import { type EmailSignIn, formatTimer } from "@/features/auth/model/use-email-sign-in";
import { BLOUB_MOVE_MS } from "@/shared/components/bloub-stage/bloub-look";
import { haptics } from "@/shared/lib/haptics";
import { SPLASH_EASE_IN_OUT } from "@/shared/lib/splash-motion";
import { useText } from "@/shared/lib/text";

const LABEL_OUT = FadeOut.duration(120).easing(SIGN_IN_TEXT_EASE);
const LABEL_IN = FadeIn.duration(180).delay(100).easing(SIGN_IN_TEXT_EASE);
const MESSAGE_HEIGHT = 20;

export interface PaneMotion {
  from: PaneDirection;
  startMs: number;
  reduced: boolean;
}

function PaneItem({
  index,
  motion,
  className,
  children,
}: {
  index: number;
  motion: PaneMotion | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Animated.View
      entering={motion ? paneEnter(index, motion.from, motion.reduced, motion.startMs) : undefined}
      className={className}
    >
      {children}
    </Animated.View>
  );
}

function SignInButton({
  label,
  labelKey = label,
  brand,
  icon: Icon,
  onPress,
  busy = false,
  waiting = false,
  reduced,
}: {
  label: string;
  labelKey?: string;
  brand: boolean;
  icon?: LucideIcon;
  onPress: () => void;
  busy?: boolean;
  waiting?: boolean;
  reduced: boolean;
}) {
  const colors = useSignInColors();
  const textColor = brand ? colors.onBrand : colors.text;
  return (
    <Button
      size="lg"
      variant="ghost"
      feedbackVariant="scale"
      className="w-full"
      accessibilityLabel={label}
      accessibilityState={{ disabled: waiting, busy }}
      style={{
        height: SIGN_IN_CONTROL_HEIGHT,
        borderRadius: colors.radius,
        backgroundColor: brand ? colors.brand : colors.surface,
      }}
      onPress={() => {
        if (busy || waiting) return;
        void haptics.impact("light");
        onPress();
      }}
    >
      <Animated.View
        key={labelKey}
        entering={reduced ? undefined : LABEL_IN}
        exiting={reduced ? undefined : LABEL_OUT}
        className="flex-row items-center gap-2"
      >
        {busy ? (
          <Spinner size="sm" color={textColor} />
        ) : Icon ? (
          <Icon size={20} color={textColor} strokeWidth={2} />
        ) : null}
        <Button.Label className="font-sans font-semibold" style={{ color: textColor, opacity: waiting ? 0.5 : 1 }}>
          {label}
        </Button.Label>
      </Animated.View>
    </Button>
  );
}

function TextAction({
  label,
  labelKey = label,
  onPress,
  disabled = false,
  reduced,
}: {
  label: string;
  labelKey?: string;
  onPress: () => void;
  disabled?: boolean;
  reduced: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={8}
      pressRetentionOffset={12}
      onPress={() => {
        void haptics.impact("light");
        onPress();
      }}
      className="min-h-11 justify-center"
      style={({ pressed }) => ({ opacity: disabled ? 0.5 : pressed ? 0.6 : 1 })}
    >
      <Animated.View key={labelKey} entering={reduced ? undefined : LABEL_IN} exiting={reduced ? undefined : LABEL_OUT}>
        <Typography.Paragraph type="body-sm" color="muted">
          {label}
        </Typography.Paragraph>
      </Animated.View>
    </Pressable>
  );
}

function PaneMessage({
  message,
  spinner,
  reduced,
}: {
  message: { key: string; text: string; color: string } | null;
  spinner: boolean;
  reduced: boolean;
}) {
  const colors = useSignInColors();
  const motion = signInMotion(reduced);
  return (
    <View className="mt-2 justify-center" style={{ minHeight: MESSAGE_HEIGHT }}>
      {message ? (
        <Animated.View
          key={message.key}
          entering={motion.fadeIn()}
          exiting={motion.fadeOut}
          className="flex-row items-center gap-2"
        >
          {spinner ? <Spinner size="sm" color={colors.muted} /> : null}
          <Typography.Paragraph
            type="body-sm"
            accessibilityRole="alert"
            className="shrink"
            style={{ color: message.color }}
          >
            {message.text}
          </Typography.Paragraph>
        </Animated.View>
      ) : null}
    </View>
  );
}

function HelpToggle({
  open,
  onToggle,
  onBodyLayout,
  reduced,
}: {
  open: boolean;
  onToggle: () => void;
  onBodyLayout?: (height: number) => void;
  reduced: boolean;
}) {
  const { t } = useText();
  const colors = useSignInColors();
  const shown = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    shown.set(
      reduced
        ? withTiming(open ? 1 : 0, { duration: 160 })
        : open
          ? withDelay(200, withTiming(1, { duration: 240, easing: SIGN_IN_EASE_OUT }))
          : withTiming(0, { duration: 120 }),
    );
  }, [open, reduced, shown]);
  const bodyStyle = useAnimatedStyle(() => ({ opacity: shown.get() }));
  const chevronStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${180 * shown.get()}deg` }] }));
  return (
    <View className="mt-3 items-center">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("mobile.auth.signIn.helpTitle")}
        accessibilityState={{ expanded: open }}
        hitSlop={8}
        onPress={() => {
          void haptics.selection();
          onToggle();
        }}
        className="min-h-11 flex-row items-center gap-1.5"
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <Typography.Paragraph type="body-sm" color="muted">
          {t("mobile.auth.signIn.helpTitle")}
        </Typography.Paragraph>
        <Animated.View style={chevronStyle}>
          <ChevronDown size={14} color={colors.muted} strokeWidth={2} />
        </Animated.View>
      </Pressable>
      <Animated.View
        style={bodyStyle}
        pointerEvents="none"
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? "auto" : "no-hide-descendants"}
        className="gap-1 pt-1.5"
        onLayout={({ nativeEvent: { layout } }) => onBodyLayout?.(layout.height)}
      >
        <Typography.Paragraph type="body-sm" color="muted">
          {t("mobile.auth.signIn.helpStep1")}
        </Typography.Paragraph>
        <Typography.Paragraph type="body-sm" color="muted">
          {t("mobile.auth.signIn.helpStep2")}
        </Typography.Paragraph>
        <Typography.Paragraph type="body-sm" color="muted">
          {t("mobile.auth.signIn.helpStep3")}
        </Typography.Paragraph>
      </Animated.View>
    </View>
  );
}

export function OptionsPane({
  motion,
  notice,
  helpOpen,
  helpShift,
  onToggleHelp,
  onScan,
  onEmail,
  onLayout,
  onHelpLayout,
  reduced,
}: {
  motion: PaneMotion | null;
  notice?: ReactNode;
  helpOpen: boolean;
  helpShift: SharedValue<number>;
  onToggleHelp: () => void;
  onScan: () => void;
  onEmail: () => void;
  onLayout?: (height: number) => void;
  onHelpLayout?: (height: number) => void;
  reduced: boolean;
}) {
  const { t } = useText();
  const riseStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -helpShift.get() }] }));
  return (
    <Animated.View style={riseStyle} onLayout={({ nativeEvent: { layout } }) => onLayout?.(layout.height)}>
      {notice ? (
        <PaneItem index={0} motion={motion} className="mb-6">
          {notice}
        </PaneItem>
      ) : null}
      <PaneItem index={0} motion={motion}>
        <Typography.Heading type="h1" accessibilityRole="header" className="tracking-openbot-tight">
          {t("mobile.auth.signIn.title")}
        </Typography.Heading>
      </PaneItem>
      <PaneItem index={1} motion={motion} className="mt-2.5">
        <Typography.Paragraph color="muted">{t("mobile.auth.signIn.subtitle")}</Typography.Paragraph>
      </PaneItem>
      <PaneItem index={2} motion={motion} className="mt-7 gap-3">
        <SignInButton brand icon={ScanLine} label={t("mobile.auth.scanQrCode")} onPress={onScan} reduced={reduced} />
        <SignInButton brand={false} label={t("mobile.auth.signIn.emailButton")} onPress={onEmail} reduced={reduced} />
      </PaneItem>
      <PaneItem index={3} motion={motion}>
        <HelpToggle open={helpOpen} onToggle={onToggleHelp} onBodyLayout={onHelpLayout} reduced={reduced} />
      </PaneItem>
    </Animated.View>
  );
}

export function EmailPane({
  signIn,
  motion,
  emailInput,
  onScanInstead,
  onLayout,
  reduced,
}: {
  signIn: EmailSignIn;
  motion: PaneMotion;
  emailInput: Ref<TextInputInstance>;
  onScanInstead: () => void;
  onLayout: (height: number) => void;
  reduced: boolean;
}) {
  const { t } = useText();
  const colors = useSignInColors();
  const { retryIn, deliveryUnconfirmed, sending, companySignIn, usesCompanySignIn } = signIn;
  const label = companySignIn
    ? t("mobile.auth.email.companyWaiting")
    : sending
      ? t("mobile.auth.email.sending")
      : usesCompanySignIn && retryIn === 0
        ? t("mobile.auth.email.companyContinue")
        : deliveryUnconfirmed
          ? retryIn > 0
            ? t("mobile.auth.email.checkAgainIn", { time: formatTimer(retryIn) })
            : t("mobile.auth.email.checkDelivery")
          : retryIn > 0
            ? t("mobile.auth.email.tryAgainIn", { time: formatTimer(retryIn) })
            : t("mobile.auth.email.send");
  const labelKey = companySignIn
    ? "company-waiting"
    : sending
      ? "sending"
      : retryIn > 0
        ? "wait"
        : usesCompanySignIn
          ? "company"
          : deliveryUnconfirmed
            ? "check"
            : "send";
  const message = signIn.emailIssue
    ? { key: `email-${signIn.rejection}`, text: signIn.emailIssue.message, color: colors.danger }
    : usesCompanySignIn
      ? { key: "company", text: t("mobile.auth.email.companyNotice"), color: colors.muted }
      : null;
  return (
    <View onLayout={({ nativeEvent: { layout } }) => onLayout(layout.height)}>
      <PaneItem index={0} motion={motion}>
        <Typography.Heading type="h2" accessibilityRole="header" className="tracking-openbot-tight">
          {t("mobile.auth.email.title")}
        </Typography.Heading>
      </PaneItem>
      <PaneItem index={1} motion={motion} className="mt-2.5">
        <Typography.Paragraph color="muted">{t("mobile.auth.email.description")}</Typography.Paragraph>
      </PaneItem>
      <PaneItem index={2} motion={motion} className="mt-5">
        <EmailField
          ref={emailInput}
          value={signIn.email}
          onChangeText={signIn.setEmail}
          onSubmit={signIn.sendCode}
          placeholder={t("mobile.auth.email.placeholder")}
          label={t("mobile.auth.email.label")}
          invalid={signIn.emailIssue?.code === "invalid_email"}
          rejection={signIn.rejection}
          editable={!sending}
          visible
          reduced={reduced}
        />
        <PaneMessage message={message} spinner={false} reduced={reduced} />
      </PaneItem>
      <PaneItem index={3} motion={motion} className="mt-2">
        <SignInButton
          brand
          label={label}
          labelKey={labelKey}
          onPress={signIn.sendCode}
          busy={sending}
          waiting={retryIn > 0}
          reduced={reduced}
        />
      </PaneItem>
      <PaneItem index={4} motion={motion} className="mt-1.5 flex-row">
        <TextAction
          label={t("mobile.auth.email.useQrCode")}
          onPress={onScanInstead}
          disabled={sending}
          reduced={reduced}
        />
      </PaneItem>
    </View>
  );
}

export function CodePane({
  signIn,
  motion,
  codeInput,
  onLayout,
  reduced,
}: {
  signIn: EmailSignIn;
  motion: PaneMotion;
  codeInput: Ref<EmailCodeInputHandle>;
  onLayout: (height: number) => void;
  reduced: boolean;
}) {
  const { t } = useText();
  const colors = useSignInColors();
  const { resendIn, resending, needsNewCode } = signIn;
  const slotMotion = (() => {
    const base = signInMotion(reduced);
    const start = motion.startMs + 2 * PANE_STAGGER_MS;
    return { ...base, enter: (delay = 0) => base.enter(reduced ? delay : start + delay) };
  })();
  const canRetry = Boolean(
    signIn.codeIssue && !signIn.codeRejected && !needsNewCode && signIn.code.length === ONE_TIME_CODE_LENGTH,
  );
  const resend = canRetry
    ? { label: t("common.retry"), key: "retry", onPress: signIn.retryVerify, waiting: false }
    : {
        label: resending
          ? t("mobile.auth.email.resending")
          : resendIn > 0
            ? t("mobile.auth.email.resendIn", { time: formatTimer(resendIn) })
            : needsNewCode
              ? t("mobile.auth.email.sendNewCode")
              : t("mobile.auth.email.resend"),
        key: resending ? "resending" : resendIn > 0 ? "resend-wait" : "resend",
        onPress: signIn.resendCode,
        waiting: resending || resendIn > 0 || signIn.busy,
      };
  const message = signIn.verified
    ? { key: "verified", text: t("mobile.auth.email.verified"), color: colors.success }
    : signIn.verifying
      ? { key: "verifying", text: t("mobile.auth.email.verifying"), color: colors.muted }
      : signIn.codeIssue
        ? { key: `code-${signIn.rejection}`, text: signIn.codeIssue.message, color: colors.danger }
        : signIn.notice
          ? { key: "notice", text: signIn.notice, color: colors.muted }
          : signIn.challenge?.developmentCode
            ? {
                key: "development",
                text: t("mobile.auth.email.developmentCode", { code: signIn.challenge.developmentCode }),
                color: colors.muted,
              }
            : null;
  const busy = signIn.verifying || signIn.verified;
  return (
    <View onLayout={({ nativeEvent: { layout } }) => onLayout(layout.height)}>
      <PaneItem index={0} motion={motion}>
        <Typography.Heading type="h2" accessibilityRole="header" className="tracking-openbot-tight">
          {t("mobile.auth.email.codeTitle")}
        </Typography.Heading>
      </PaneItem>
      <PaneItem index={1} motion={motion} className="mt-2.5">
        <Typography.Paragraph color="muted">
          {t("mobile.auth.email.codeSent", { email: signIn.challenge?.email ?? signIn.email })}
        </Typography.Paragraph>
      </PaneItem>
      <View className="mt-5">
        <EmailCodeInput
          ref={codeInput}
          value={signIn.code}
          onChange={signIn.setCode}
          onComplete={signIn.verify}
          status={
            signIn.verified ? "verified" : signIn.verifying ? "verifying" : signIn.codeRejected ? "invalid" : "idle"
          }
          rejection={signIn.rejection}
          disabled={needsNewCode || signIn.verified}
          accessibilityLabel={t("mobile.auth.email.codeLabel")}
          motion={slotMotion}
          reduced={reduced}
        />
        <PaneMessage message={message} spinner={signIn.verifying} reduced={reduced} />
      </View>
      <PaneItem index={3} motion={motion} className="mt-1.5 flex-row justify-between">
        <TextAction
          label={resend.label}
          labelKey={resend.key}
          onPress={resend.onPress}
          disabled={resend.waiting}
          reduced={reduced}
        />
        <TextAction
          label={t("mobile.auth.email.changeEmail")}
          onPress={signIn.back}
          disabled={busy}
          reduced={reduced}
        />
      </PaneItem>
    </View>
  );
}

export const HELP_MOVE = { duration: BLOUB_MOVE_MS, easing: SPLASH_EASE_IN_OUT };
