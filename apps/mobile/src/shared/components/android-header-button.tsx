import { Stack } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import type { LucideIcon } from "lucide-react-native";
import ArrowLeft from "lucide-react-native/icons/arrow-left";
import { type ReactNode, useLayoutEffect, useMemo, useRef } from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import { ChromeGlassSheen } from "@/shared/components/chrome-glass-sheen";
import { useChromeGlass } from "@/shared/lib/chrome-glass";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

/** The 40 dp round state layer of a Material icon button. */
const ICON_RIPPLE = { borderless: true, radius: 20 } as const;
const TEXT_RIPPLE = { borderless: false } as const;

/**
 * A header button for Android. `Stack.Toolbar.Button` on Android shows only an image icon, so a
 * button with an SF Symbol or a text label does not appear. iOS keeps `Stack.Toolbar`. A button
 * with `text` shows that text instead of an icon. A full screen sets `glass`: its icon sits in the
 * glass circle of the search field. A sheet keeps the plain icon.
 *
 * The header options change only when the button looks different. New options make the navigator
 * set them again and Android rebuild the toolbar, which a form did on every key press before.
 */
export function AndroidHeaderButton({
  placement,
  icon: Icon,
  text,
  accessibilityLabel,
  hidden = false,
  disabled = false,
  glass: hasGlass = false,
  onPress,
}: {
  placement: "left" | "right";
  accessibilityLabel: string;
  glass?: boolean;
  hidden?: boolean;
  disabled?: boolean;
  onPress: () => void;
} & ({ icon: LucideIcon; text?: undefined } | { icon?: undefined; text: string })) {
  const foreground = String(useThemeColor("foreground"));
  const glass = useChromeGlass();
  const press = useRef(onPress);
  useLayoutEffect(() => {
    press.current = onPress;
  });
  const options = useMemo(() => {
    const button = hidden
      ? undefined
      : () => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            accessibilityState={{ disabled }}
            disabled={disabled}
            // A Material tonal icon button: a 40 dp filled circle in a 48 dp target, or a text button.
            android_ripple={text ? TEXT_RIPPLE : ICON_RIPPLE}
            className={`${text ? "h-10 overflow-hidden px-3" : "size-12"} items-center justify-center rounded-full`}
            style={{ opacity: disabled ? 0.38 : 1 }}
            onPress={() => press.current()}
          >
            {Icon ? (
              <GlassCircle glass={hasGlass ? glass : undefined}>
                <Icon color={foreground} size={22} strokeWidth={2} />
              </GlassCircle>
            ) : (
              <Typography.Paragraph weight="medium" style={{ color: foreground }}>
                {text}
              </Typography.Paragraph>
            )}
          </Pressable>
        );
    return placement === "left" ? { headerLeft: button } : { headerRight: button };
  }, [Icon, accessibilityLabel, disabled, foreground, glass, hasGlass, hidden, placement, text]);
  return <Stack.Screen options={options} />;
}

/** The round back button that `androidBackOptions` puts in the header. */
function AndroidStackBackButton({ glass: hasGlass, onPress }: { glass: boolean; onPress: () => void }) {
  const { t } = useText();
  const foreground = useThemeColor("foreground");
  const glass = useChromeGlass();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("common.back")}
      android_ripple={ICON_RIPPLE}
      className="size-12 items-center justify-center rounded-full"
      onPress={() => {
        void haptics.impact("soft");
        onPress();
      }}
    >
      <GlassCircle glass={hasGlass ? glass : undefined}>
        <ArrowLeft color={String(foreground)} size={22} strokeWidth={2} />
      </GlassCircle>
    </Pressable>
  );
}

/**
 * Screen options for a stack on Android: every page after the first gets the round back button of
 * `AndroidHeaderButton` in place of the native arrow, so all header buttons look the same. A page
 * that sets its own `headerLeft` keeps it. Use it in a `screenOptions` function. `glass` puts the
 * arrow in the glass circle, for the full screens; sheets keep the plain arrow.
 */
export function androidBackOptions(
  {
    navigation,
    route,
  }: {
    navigation: { getState(): { routes: readonly { key: string }[] }; goBack(): void };
    // Expo Router 58 types a route key as optional.
    route: { key?: string };
  },
  { glass = false }: { glass?: boolean } = {},
) {
  if (!isAndroid || navigation.getState().routes[0]?.key === route.key) return null;
  return { headerLeft: () => <AndroidStackBackButton glass={glass} onPress={() => navigation.goBack()} /> };
}

/** The 40 dp circle of a header icon: the glass of the search field, or nothing in a sheet. */
function GlassCircle({ glass, children }: { glass?: ViewStyle; children: ReactNode }) {
  return (
    <View className="size-10 items-center justify-center overflow-hidden rounded-full" style={glass}>
      {glass ? <ChromeGlassSheen /> : null}
      {children}
    </View>
  );
}
