import { router } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { Button, Typography } from "heroui-native";
import Star from "lucide-react-native/icons/star";
import { useCallback, useEffect, useState } from "react";
import { BackHandler, Pressable, ScrollView, View } from "react-native";
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { SIGN_IN_CONTROL_HEIGHT, useSignInColors } from "@/features/auth/components/sign-in-colors";
import { finishRatingAsk, openStoreReview, openXPost } from "@/features/rating-ask/model/rating-ask";
import { BLOUB_MOVE_MS, BLOUB_RADIUS, useBloubColors } from "@/shared/components/bloub-stage/bloub-look";
import { useBloubStageRequest } from "@/shared/components/bloub-stage/bloub-stage-context";
import {
  BLOUB_PRIORITY,
  type BloubMood,
  type BloubStageRequest,
} from "@/shared/components/bloub-stage/bloub-stage-store";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { isIOS } from "@/shared/lib/platform";
import { SPLASH_EASE_OUT } from "@/shared/lib/splash-motion";
import { useText } from "@/shared/lib/text";
import { useAppActive } from "@/shared/lib/use-app-active";

type Rating = 1 | 2 | 3 | 4 | 5;
const STARS: readonly Rating[] = [1, 2, 3, 4, 5];
const STAR_MOOD = { 1: "cry", 2: "sad", 3: "meh", 4: "happy", 5: "joy" } as const satisfies Record<Rating, BloubMood>;
const HINT = {
  1: "mobile.app.rate.hint.1",
  2: "mobile.app.rate.hint.2",
  3: "mobile.app.rate.hint.3",
  4: "mobile.app.rate.hint.4",
  5: "mobile.app.rate.hint.5",
} as const;
const HEADER_SHARE = 0.38;
const PANEL_DELAY_MS = BLOUB_MOVE_MS - 60;
const PANEL_OPEN = { duration: 600, easing: SPLASH_EASE_OUT };
const ROW_DELAY_MS = PANEL_DELAY_MS + 200;
const ROW_STAGGER_MS = 40;
const ROW_FADE_MS = 260;
const PANEL_CLOSE = { duration: 320, easing: SPLASH_EASE_OUT };
const PANEL_TOP_GAP = 20;

function rowEntering(index: number, reduced: boolean) {
  if (reduced) return undefined;
  return FadeIn.duration(ROW_FADE_MS)
    .delay(ROW_DELAY_MS + index * ROW_STAGGER_MS)
    .easing(SPLASH_EASE_OUT);
}

function leave(): void {
  router.back();
}

const THANKS_MS = 1500;
const JOY_THANKS_MS = 2200;
const STAR_SIZE = 44;

function RatingStar({
  value,
  rating,
  color,
  emptyColor,
  label,
  reduced,
  onPress,
}: {
  value: Rating;
  rating: Rating | null;
  color: string;
  emptyColor: string;
  label: string;
  reduced: boolean;
  onPress: (value: Rating) => void;
}) {
  const on = rating !== null && value <= rating;
  const scale = useSharedValue(1);
  useEffect(() => {
    if (rating === null || value > rating || reduced) return;
    const delay = (value - 1) * 35;
    scale.set(
      withSequence(
        withTiming(1, { duration: delay }),
        withTiming(1.25, { duration: 130, easing: SPLASH_EASE_OUT }),
        withTiming(1, { duration: 190, easing: SPLASH_EASE_OUT }),
      ),
    );
  }, [rating, reduced, scale, value]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: value === rating }}
      hitSlop={4}
      onPress={() => onPress(value)}
    >
      <Animated.View style={style}>
        <Star size={STAR_SIZE} color={on ? color : emptyColor} fill={on ? color : emptyColor} strokeWidth={1.5} />
      </Animated.View>
    </Pressable>
  );
}

export function RatingAskScreen() {
  const { t } = useText();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const bloub = useBloubColors();
  const colors = useSignInColors();
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [rating, setRating] = useState<Rating | null>(null);
  const [thanks, setThanks] = useState<"rated" | "feedback" | null>(null);
  const [opening, setOpening] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = useSharedValue(0);

  const measured = viewport.height > 0;
  const headerBottom = Math.round(viewport.height * HEADER_SHARE);
  const panelTop = headerBottom - BLOUB_RADIUS;
  const panelHeight = Math.max(0, viewport.height - panelTop);

  useEffect(() => {
    if (!measured) return;
    open.set(reduced ? 1 : withDelay(PANEL_DELAY_MS, withTiming(1, PANEL_OPEN)));
  }, [measured, open, reduced]);

  const close = useCallback(() => {
    if (closing) return;
    setClosing(true);
    if (reduced) {
      leave();
      return;
    }
    open.set(
      withTiming(0, PANEL_CLOSE, () => {
        scheduleOnRN(leave);
      }),
    );
  }, [closing, open, reduced]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      close();
      return true;
    });
    return () => subscription.remove();
  }, [close]);

  const appActive = useAppActive();
  useEffect(() => {
    if (!thanks || !appActive) return;
    const timer = setTimeout(close, rating === 5 ? JOY_THANKS_MS : THANKS_MS);
    return () => clearTimeout(timer);
  }, [appActive, close, rating, thanks]);

  const mood: BloubMood = thanks
    ? thanks === "rated" && rating === 5
      ? "joy"
      : "happy"
    : closing
      ? "down"
      : rating
        ? STAR_MOOD[rating]
        : "idle";
  const request: BloubStageRequest | null =
    !isFocused || !measured
      ? null
      : {
          shape: { kind: "header", bottom: headerBottom },
          mood,
          back: { icon: "close", label: t("common.close"), onPress: close, disabled: opening || closing },
        };
  useBloubStageRequest(request, BLOUB_PRIORITY.screen);

  const panelStyle = useAnimatedStyle(() => ({
    opacity: open.get() > 0 ? 1 : 0,
    transform: [{ translateY: -(1 - open.get()) * panelHeight }],
  }));

  function rate(value: Rating) {
    void haptics.selection();
    setError(null);
    setRating(value);
  }

  async function submit(destination: "store" | "x") {
    if (opening) return;
    setError(null);
    setOpening(true);
    try {
      if (destination === "store") await openStoreReview();
      else await openXPost();
      void haptics.notification("success");
      finishRatingAsk();
      setThanks(destination === "store" ? "rated" : "feedback");
    } catch {
      setError(t("mobile.app.rate.openFailed"));
    } finally {
      setOpening(false);
    }
  }

  const busy = opening || closing;
  const storeLabel = isIOS ? t("mobile.app.rate.appStore") : t("mobile.app.rate.googlePlay");

  return (
    <View
      className="flex-1"
      onLayout={({ nativeEvent: { layout } }) => setViewport({ width: layout.width, height: layout.height })}
    >
      {measured ? (
        <Animated.View
          className="absolute inset-x-0 overflow-hidden bg-background"
          style={[{ top: panelTop, height: panelHeight }, panelStyle]}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentInsetAdjustmentBehavior="never"
            bounces={false}
            showsVerticalScrollIndicator={false}
            contentContainerClassName="px-6"
            contentContainerStyle={{
              flexGrow: 1,
              paddingTop: BLOUB_RADIUS + PANEL_TOP_GAP,
              paddingBottom: insets.bottom + 16,
            }}
          >
            <Animated.View entering={rowEntering(0, reduced)}>
              <Typography.Heading type="h3" accessibilityRole="header" className="tracking-openbot-tight">
                {thanks === "feedback"
                  ? t("mobile.app.rate.feedbackThanks")
                  : thanks
                    ? t("mobile.app.rate.thanks")
                    : t("mobile.app.rate.title")}
              </Typography.Heading>
            </Animated.View>
            {thanks ? null : (
              <>
                <Animated.View entering={rowEntering(1, reduced)}>
                  <Typography.Paragraph className="mt-1.5 text-muted">{t("mobile.app.rate.body")}</Typography.Paragraph>
                </Animated.View>
                <Animated.View
                  entering={rowEntering(2, reduced)}
                  accessibilityRole="radiogroup"
                  accessibilityLabel={t("mobile.app.rate.ratingLabel")}
                  className="mt-5 flex-row gap-2"
                >
                  {STARS.map((value) => (
                    <RatingStar
                      key={value}
                      value={value}
                      rating={rating}
                      color={bloub.body}
                      emptyColor={colors.surface}
                      label={t("mobile.app.rate.star", { count: value })}
                      reduced={reduced}
                      onPress={rate}
                    />
                  ))}
                </Animated.View>
                <Animated.View entering={rowEntering(3, reduced)}>
                  <Typography.Paragraph type="body-sm" className="mt-2.5 text-muted" accessibilityLiveRegion="polite">
                    {rating ? t(HINT[rating]) : t("mobile.app.rate.hint.none")}
                  </Typography.Paragraph>
                </Animated.View>
                <View className="min-h-6 flex-1" />
                <Animated.View entering={rowEntering(4, reduced)} className="gap-1">
                  <Button
                    size="lg"
                    variant="ghost"
                    feedbackVariant="scale"
                    isDisabled={busy}
                    accessibilityLabel={storeLabel}
                    style={{ height: SIGN_IN_CONTROL_HEIGHT, borderRadius: colors.radius, backgroundColor: bloub.body }}
                    onPress={() => void submit("store")}
                  >
                    <Button.Label className="font-sans font-semibold" style={{ color: bloub.eye }}>
                      {storeLabel}
                    </Button.Label>
                  </Button>
                  <Button
                    size="lg"
                    variant="ghost"
                    feedbackVariant="scale"
                    isDisabled={busy}
                    accessibilityLabel={t("mobile.app.rate.postX")}
                    accessibilityHint={t("mobile.app.rate.xNote")}
                    style={{
                      height: SIGN_IN_CONTROL_HEIGHT,
                      borderRadius: colors.radius,
                      backgroundColor: colors.surface,
                    }}
                    onPress={() => void submit("x")}
                  >
                    <Button.Label className="font-sans font-semibold" style={{ color: colors.text }}>
                      {t("mobile.app.rate.postX")}
                    </Button.Label>
                  </Button>
                  <Button
                    size="lg"
                    variant="ghost"
                    feedbackVariant="scale"
                    isDisabled={busy}
                    style={{ height: SIGN_IN_CONTROL_HEIGHT }}
                    onPress={close}
                  >
                    <Button.Label className="font-sans font-semibold text-muted">
                      {t("mobile.app.rate.notNow")}
                    </Button.Label>
                  </Button>
                  {error ? (
                    <Typography.Paragraph
                      type="body-sm"
                      align="center"
                      className="text-danger-text"
                      accessibilityRole="alert"
                    >
                      {error}
                    </Typography.Paragraph>
                  ) : null}
                </Animated.View>
              </>
            )}
          </ScrollView>
        </Animated.View>
      ) : null}
    </View>
  );
}
