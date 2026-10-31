import { ONE_TIME_CODE_ALPHABET, ONE_TIME_CODE_LENGTH } from "@openbot/contracts/validation";
import { Typography } from "heroui-native";
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Platform, StyleSheet, TextInput, type TextInputInstance, View } from "react-native";
import Animated, {
  FadeOut,
  Keyframe,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { SIGN_IN_CONTROL_HEIGHT, type SignInColors, useSignInColors } from "@/features/auth/components/sign-in-colors";
import { SIGN_IN_EASE_OUT, type SignInMotion } from "@/features/auth/components/sign-in-motion";
import { useShake } from "@/features/auth/components/use-shake";

type EmailCodeStatus = "idle" | "verifying" | "invalid" | "verified";

export interface EmailCodeInputHandle {
  focus: () => void;
}

interface EmailCodeInputProps {
  ref?: Ref<EmailCodeInputHandle>;
  value: string;
  onChange: (value: string) => void;
  onComplete: (value: string) => void;
  status: EmailCodeStatus;
  /** Grows on each rejected code, so the row shakes again for the same message. */
  rejection: number;
  disabled: boolean;
  accessibilityLabel: string;
  motion: SignInMotion;
  reduced: boolean;
}

const GROUP_SIZE = 4;
// Slots rise in one after another: the last one starts 240 ms after the first.
const SLOT_STAGGER_MS = 30;
// The email shows the code as `XXXX-XXXX`. Paste and autofill keep the dash,
// and a paste into a field that has part of a code adds to that part. The native field
// takes all of it, and the code is read from it below. A native limit of the code length cut the text
// before that read. HeroUI `InputOTP` fixes the native length at the code length and cuts the pasted
// code short, so this field draws its own slots.
const NATIVE_MAX_LENGTH = 64;
const CHARACTER_ENTER = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 6 }, { scale: 0.85 }] },
  100: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }], easing: SIGN_IN_EASE_OUT },
}).duration(180);
const CHARACTER_EXIT = FadeOut.duration(90);
const SLOT_POSITIONS = Array.from({ length: ONE_TIME_CODE_LENGTH }, (_, index) => index);

/** Uppercases the text, drops spaces, dashes and characters outside the code alphabet. */
function normalizeCodeInput(text: string): string {
  return [...text.toUpperCase()]
    .filter((character) => ONE_TIME_CODE_ALPHABET.includes(character))
    .join("")
    .slice(0, ONE_TIME_CODE_LENGTH);
}

export function EmailCodeInput({
  ref,
  value,
  onChange,
  onComplete,
  status,
  rejection,
  disabled,
  accessibilityLabel,
  motion,
  reduced,
}: EmailCodeInputProps) {
  const colors = useSignInColors();
  const input = useRef<TextInputInstance>(null);
  const [focused, setFocused] = useState(false);
  const shake = useShake(rejection, reduced);
  const scale = useSharedValue(1);

  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), []);

  // Focus after the frame that mounts the row. The email field leaves in the same change, and a
  // focus during that change can lose the keyboard.
  useEffect(() => {
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (status !== "verified" || reduced) return;
    scale.set(
      withSequence(
        withTiming(1.03, { duration: 140, easing: SIGN_IN_EASE_OUT }),
        withSpring(1, { duration: 400, dampingRatio: 1 }),
      ),
    );
  }, [reduced, scale, status]);

  const pulse = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const activeIndex = Math.min(value.length, ONE_TIME_CODE_LENGTH - 1);
  const editing = focused && !disabled && status === "idle";

  const slots = SLOT_POSITIONS.map((index) => (
    <Animated.View key={index} entering={motion.enter(index * SLOT_STAGGER_MS)} className="flex-1">
      <CodeSlot
        index={index}
        character={value[index] ?? null}
        active={editing && index === activeIndex}
        caret={editing && index === value.length}
        status={status}
        colors={colors}
        reduced={reduced}
      />
    </Animated.View>
  ));

  return (
    <Animated.View style={shake} className="w-full">
      <Animated.View style={pulse}>
        <View
          className="w-full flex-row items-center gap-1"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {slots.slice(0, GROUP_SIZE)}
          <Animated.View entering={motion.enter(GROUP_SIZE * SLOT_STAGGER_MS)}>
            <View className="h-0.5 w-1.5 rounded-full" style={{ backgroundColor: colors.muted }} />
          </Animated.View>
          {slots.slice(GROUP_SIZE)}
        </View>
      </Animated.View>
      <TextInput
        ref={input}
        value={value}
        onChangeText={(text) => {
          // A full code pasted after part of a code replaces that part: "AB" and a pasted
          // "ABCD-2345" give "ABCD2345", not "ABABCD23".
          const added = normalizeCodeInput(text.startsWith(value) ? text.slice(value.length) : text);
          const next = added.length === ONE_TIME_CODE_LENGTH ? added : normalizeCodeInput(text);
          if (next === value) return;
          onChange(next);
          if (next.length === ONE_TIME_CODE_LENGTH) onComplete(next);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        editable={!disabled}
        maxLength={NATIVE_MAX_LENGTH}
        autoCapitalize="characters"
        autoCorrect={false}
        spellCheck={false}
        autoComplete={Platform.OS === "android" ? "sms-otp" : "one-time-code"}
        textContentType="oneTimeCode"
        keyboardType={Platform.OS === "ios" ? "ascii-capable" : "visible-password"}
        returnKeyType="done"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled, busy: status === "verifying" }}
        // iOS does not paste into a field with no opacity, so the field is nearly transparent and
        // hides its own caret. The slots show the position.
        caretHidden={Platform.OS === "ios"}
        selectionColor="transparent"
        className="absolute inset-0 text-transparent"
        style={{ opacity: Platform.OS === "ios" ? 0.02 : 0 }}
      />
    </Animated.View>
  );
}

function CodeSlot({
  index,
  character,
  active,
  caret,
  status,
  colors,
  reduced,
}: {
  index: number;
  character: string | null;
  active: boolean;
  caret: boolean;
  status: EmailCodeStatus;
  colors: SignInColors;
  reduced: boolean;
}) {
  const ringColor = status === "invalid" ? colors.danger : status === "verified" ? colors.success : colors.brand;
  const ring = active || status === "invalid" || status === "verified";
  return (
    <View
      className="items-center justify-center overflow-hidden"
      style={{
        height: SIGN_IN_CONTROL_HEIGHT,
        borderRadius: colors.radius,
        borderCurve: "continuous",
        backgroundColor: colors.surface,
      }}
    >
      {character ? (
        <Animated.View
          key={character}
          entering={reduced ? undefined : CHARACTER_ENTER}
          exiting={reduced ? undefined : CHARACTER_EXIT}
        >
          <Typography className="font-sans text-[22px] font-semibold" style={{ color: colors.text }}>
            {character}
          </Typography>
        </Animated.View>
      ) : caret ? (
        <Caret color={colors.brand} reduced={reduced} />
      ) : null}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Animated.View
          style={{
            flex: 1,
            borderRadius: colors.radius,
            borderCurve: "continuous",
            borderWidth: 1.5,
            borderColor: ringColor,
            opacity: ring ? 1 : 0,
            transitionProperty: ["opacity", "borderColor"],
            transitionDuration: reduced ? 0 : 160,
            // A correct code turns the slots green from left to right.
            transitionDelay: status === "verified" && !reduced ? index * SLOT_STAGGER_MS : 0,
            transitionTimingFunction: "ease-out",
          }}
        />
      </View>
    </View>
  );
}

function Caret({ color, reduced }: { color: string; reduced: boolean }) {
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (reduced) return;
    opacity.set(
      withRepeat(
        withSequence(withTiming(1, { duration: 450 }), withTiming(0, { duration: 350, easing: SIGN_IN_EASE_OUT })),
        -1,
      ),
    );
  }, [opacity, reduced]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return <Animated.View style={[style, { backgroundColor: color }]} className="h-6 w-0.5 rounded-full" />;
}
