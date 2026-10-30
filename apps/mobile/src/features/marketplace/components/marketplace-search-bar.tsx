import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import CircleX from "lucide-react-native/icons/circle-x";
import Search from "lucide-react-native/icons/search";
import SlidersHorizontal from "lucide-react-native/icons/sliders-horizontal";
import X from "lucide-react-native/icons/x";
import { useRef } from "react";
import { Keyboard, Pressable, TextInput, type TextInputInstance, View } from "react-native";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, { FadeIn, FadeOut, useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCSSVariable, useUniwind } from "uniwind";
import { useBottomFieldMetrics } from "@/shared/components/bottom-field-metrics";
import { GlassCapsule } from "@/shared/components/glass-capsule";
import { type MenuAction, MenuView } from "@/shared/components/menu-view";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { isAndroid } from "@/shared/lib/platform";
import { selectionColorProps } from "@/shared/lib/selection-color";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";
import { useLiquidGlass } from "@/shared/lib/use-liquid-glass";
import {
  CATEGORY_LABELS,
  isMarketplaceFiltered,
  KIND_LABELS,
  MARKETPLACE_CATEGORIES,
  MARKETPLACE_KINDS,
  type MarketplaceFilter,
} from "../model/marketplace-listings";

/** The gap between the field and the keyboard, as home search. */
const KEYBOARD_GAP = 8;

/**
 * The field at the bottom of the Marketplace. It is the home search field, with a filter button that
 * opens a native menu; each filter that is set shows as a token in the field and narrows the page.
 */
export function MarketplaceSearchBar({
  query,
  onQueryChange,
  filter,
  onFilterChange,
  focused,
  onFocusedChange,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  filter: MarketplaceFilter;
  onFilterChange: (filter: MarketplaceFilter) => void;
  focused: boolean;
  onFocusedChange: (focused: boolean) => void;
}) {
  const { t } = useText();
  const { theme } = useUniwind();
  const input = useRef<TextInputInstance>(null);
  const insets = useSafeAreaInsets();
  const liquidGlass = useLiquidGlass();
  const reduced = useReducedMotion();
  const [foreground, muted, fieldBackground] = useThemeColor(["foreground", "muted", "default"]);
  const accent = String(useCSSVariable("--openbot-accent-text"));
  // As home search: iOS sets the field into the home indicator area; Android stays above the handle.
  const { height: fieldHeight, bottomGap } = useBottomFieldMetrics();
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const barStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.max(0, Math.abs(keyboardHeight.get()) - (bottomGap - KEYBOARD_GAP)) }],
  }));
  const filtered = isMarketplaceFiltered(filter);
  const showsClose = focused || query.length > 0;

  function close() {
    void haptics.impact("soft");
    input.current?.blur();
    Keyboard.dismiss();
    onQueryChange("");
    onFocusedChange(false);
  }

  function choose(event: string) {
    void haptics.selection();
    const [part, value] = event.split(":");
    if (part === "kind") onFilterChange({ ...filter, kind: MARKETPLACE_KINDS.find((kind) => kind === value) ?? null });
    if (part === "category")
      onFilterChange({ ...filter, category: MARKETPLACE_CATEGORIES.find((category) => category === value) ?? null });
    if (part === "installed") onFilterChange({ ...filter, installed: !filter.installed });
  }

  const actions: MenuAction[] = [
    {
      id: "kinds",
      title: "",
      displayInline: true,
      subactions: [
        { id: "kind:all", title: t("mobile.marketplace.filter.allKinds"), state: filter.kind === null ? "on" : "off" },
        ...MARKETPLACE_KINDS.map(
          (kind): MenuAction => ({
            id: `kind:${kind}`,
            title: t(KIND_LABELS[kind]),
            state: filter.kind === kind ? "on" : "off",
          }),
        ),
      ],
    },
    {
      id: "category",
      title: t("mobile.marketplace.filter.category"),
      image: "folder",
      // Android draws a sub-menu as a layer under its row, which runs off the screen above a bottom
      // field, and a menu with a sub-menu cannot scroll. The categories are one more group there.
      displayInline: isAndroid,
      subactions: [
        {
          id: "category:all",
          title: t("mobile.marketplace.filter.allCategories"),
          state: filter.category === null ? "on" : "off",
        },
        ...MARKETPLACE_CATEGORIES.map(
          (category): MenuAction => ({
            id: `category:${category}`,
            title: t(CATEGORY_LABELS[category]),
            state: filter.category === category ? "on" : "off",
          }),
        ),
      ],
    },
    {
      id: "installed",
      title: t("mobile.marketplace.filter.installed"),
      image: "checkmark.circle",
      state: filter.installed ? "on" : "off",
    },
  ];

  const tokens = [
    filter.kind ? { id: "kind", label: t(KIND_LABELS[filter.kind]) } : null,
    filter.category ? { id: "category", label: t(CATEGORY_LABELS[filter.category]) } : null,
    filter.installed ? { id: "installed", label: t("mobile.marketplace.installed") } : null,
  ].filter((token) => token !== null);

  function removeToken(id: string) {
    void haptics.impact("soft");
    if (id === "kind") onFilterChange({ ...filter, kind: null });
    if (id === "category") onFilterChange({ ...filter, category: null });
    if (id === "installed") onFilterChange({ ...filter, installed: false });
  }

  return (
    <Animated.View
      className="absolute flex-row items-center gap-2"
      pointerEvents="box-none"
      style={[{ bottom: bottomGap, left: insets.left + 16, right: insets.right + 16 }, barStyle]}
    >
      <View className="min-w-0 flex-1">
        <GlassCapsule liquidGlass={liquidGlass} fallbackBackground={fieldBackground} height={fieldHeight}>
          <View className="flex-1 flex-row items-center gap-2 pr-3 pl-4">
            <Search color={String(muted)} size={18} strokeWidth={2} />
            {tokens.map((token) => (
              <Pressable
                key={token.id}
                accessibilityRole="button"
                accessibilityLabel={t("mobile.marketplace.filter.remove", { name: token.label })}
                className="flex-row items-center gap-0.5 rounded-full py-1 pr-1.5 pl-2.5"
                style={({ pressed }) => ({ backgroundColor: `${accent}24`, opacity: pressed ? 0.6 : 1 })}
                onPress={() => removeToken(token.id)}
              >
                <Typography.Paragraph numberOfLines={1} style={{ ...typeScale.caption, color: accent }}>
                  {token.label}
                </Typography.Paragraph>
                <X color={accent} size={13} strokeWidth={2.6} />
              </Pressable>
            ))}
            <TextInput
              ref={input}
              value={query}
              onChangeText={onQueryChange}
              onFocus={() => {
                void haptics.impact("soft");
                onFocusedChange(true);
              }}
              onBlur={() => onFocusedChange(false)}
              placeholder={filtered ? t("common.search") : t("mobile.marketplace.search.placeholder")}
              placeholderTextColor={String(muted)}
              accessibilityLabel={t("mobile.marketplace.search.placeholder")}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              submitBehavior="blurAndSubmit"
              {...selectionColorProps(String(foreground))}
              className="h-10 min-w-0 flex-1 font-sans text-foreground"
              style={{ fontSize: 16, lineHeight: 20, paddingBottom: 0, paddingTop: 0, textAlignVertical: "center" }}
            />
            {query ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("mobile.marketplace.search.clear")}
                hitSlop={8}
                className="items-center justify-center px-1"
                onPress={() => {
                  void haptics.impact("soft");
                  onQueryChange("");
                }}
              >
                <CircleX color={String(muted)} size={18} strokeWidth={2} />
              </Pressable>
            ) : null}
          </View>
        </GlassCapsule>
      </View>
      {/* Its own capsule, beside the field: the iOS menu grows out of the button it opens from, so a
          button inside the field would take the whole field into the menu. */}
      <MenuView
        colorScheme={theme === "dark" ? "dark" : "light"}
        title={t("mobile.marketplace.filter.title")}
        actions={actions}
        onPressAction={({ nativeEvent }) => choose(nativeEvent.event)}
      >
        <GlassCapsule
          liquidGlass={liquidGlass}
          fallbackBackground={fieldBackground}
          width={fieldHeight}
          height={fieldHeight}
        >
          <View
            accessible
            accessibilityRole="button"
            accessibilityLabel={t("mobile.marketplace.filter.title")}
            accessibilityState={{ selected: filtered }}
            className="flex-1 items-center justify-center"
            style={filtered ? { backgroundColor: `${accent}24` } : undefined}
          >
            <SlidersHorizontal color={filtered ? accent : String(foreground)} size={20} strokeWidth={2} />
          </View>
        </GlassCapsule>
      </MenuView>
      {showsClose ? (
        <Animated.View
          entering={reduced ? undefined : FadeIn.duration(200)}
          exiting={reduced ? undefined : FadeOut.duration(160)}
        >
          <GlassCapsule
            liquidGlass={liquidGlass}
            fallbackBackground={fieldBackground}
            width={fieldHeight}
            height={fieldHeight}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("mobile.marketplace.search.close")}
              className="flex-1 items-center justify-center"
              hitSlop={4}
              style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
              onPress={close}
            >
              <ChevronDown color={String(foreground)} size={22} strokeWidth={2.2} />
            </Pressable>
          </GlassCapsule>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}
