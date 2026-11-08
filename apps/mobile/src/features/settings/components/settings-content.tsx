import { ListGroup, Typography } from "heroui-native";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import { Children, type PropsWithChildren, type ReactNode, useState } from "react";
import {
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
  type LayoutChangeEvent,
  type ScrollViewProps,
  useWindowDimensions,
  View,
} from "react-native";
import { useCSSVariable } from "uniwind";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { haptics } from "@/shared/lib/haptics";
import { MIRROR_IN_RTL } from "@/shared/lib/text-direction";

/**
 * `androidNativeHeader`: the page keeps the native Android header, for a `Stack.SearchBar`.
 * `onScroll`: for a long list that adds its rows as the reader scrolls.
 */
export function SettingsContent({
  children,
  androidNativeHeader,
  onScroll,
}: PropsWithChildren<{ androidNativeHeader?: boolean; onScroll?: ScrollViewProps["onScroll"] }>) {
  return (
    <SheetScrollView
      androidNativeHeader={androidNativeHeader}
      onScroll={onScroll}
      scrollEdgeEffect={false}
      contentContainerClassName="gap-7 px-4 pb-safe-offset-5 pt-5"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </SheetScrollView>
  );
}

export function SettingsSection({
  title,
  footer,
  children,
}: PropsWithChildren<{ title?: string; footer?: ReactNode }>) {
  return (
    <View className="gap-2">
      {title ? (
        <Typography type="body-xs" className="px-4 text-grouped-secondary">
          {title}
        </Typography>
      ) : null}
      <ListGroup variant="secondary" className="overflow-hidden rounded-grouped bg-grouped p-0 shadow-none">
        {Children.map(Children.toArray(children), (child, index) =>
          child ? (
            <View>
              {index > 0 ? <View className="ml-4 h-px bg-grouped-border" /> : null}
              {child}
            </View>
          ) : null,
        )}
      </ListGroup>
      {footer ? (
        <Typography.Paragraph type="body-xs" className="px-4 text-grouped-secondary">
          {footer}
        </Typography.Paragraph>
      ) : null}
    </View>
  );
}

export function SettingsNote({ children }: PropsWithChildren) {
  return (
    <View className="px-4 pb-3">
      <Typography.Paragraph type="body-xs" className="text-grouped-secondary">
        {children}
      </Typography.Paragraph>
    </View>
  );
}

/**
 * From the iOS "xxxLarge" text size (1.35) and its Android equivalent, a value beside its title can
 * squeeze the title to one letter a line. As in the iOS Settings app, such a row puts the value
 * under the title. Smaller text sizes keep the one-line row.
 */
const STACKED_FONT_SCALE = 1.3;
/** A trailing value wider than this part of the row goes under the title. An icon never does. */
const STACKED_VALUE_SHARE = 0.4;
/** `px-4` on both sides of a row. */
const ROW_PADDING_X = 32;

export function SettingsRow({
  children,
  supportingText,
  onPress,
  trailing,
  disabled = false,
  leading,
  disclosure = true,
  accessibilityLabel,
  checked,
  multiple = false,
  expanded,
  accessibilityActions,
  onAccessibilityAction,
}: PropsWithChildren<{
  supportingText?: string;
  onPress?: () => void;
  trailing?: ReactNode;
  disabled?: boolean;
  leading?: ReactNode;
  disclosure?: boolean;
  /** For an action row whose visible text needs its context, such as the item it acts on. */
  accessibilityLabel?: string;
  /** Makes the row one choice of a list. True when it is the selected choice. */
  checked?: boolean;
  /** With `checked`: the row is one choice of a list where more than one can be on. */
  multiple?: boolean;
  /** For a row that shows or hides the rows below it. */
  expanded?: boolean;
  /**
   * For a control in `trailing` of a row with `onPress`: VoiceOver and TalkBack read the row as one
   * element, so the control needs an action of the row too.
   */
  accessibilityActions?: AccessibilityActionInfo[];
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
}>) {
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const { fontScale } = useWindowDimensions();
  const measures = Boolean(trailing) && fontScale >= STACKED_FONT_SCALE;
  const [rowWidth, setRowWidth] = useState(0);
  const [trailingWidth, setTrailingWidth] = useState(0);
  const stacked = measures && rowWidth > 0 && trailingWidth > (rowWidth - ROW_PADDING_X) * STACKED_VALUE_SHARE;
  const onRowLayout = measures
    ? (event: LayoutChangeEvent) => setRowWidth(Math.round(event.nativeEvent.layout.width))
    : undefined;
  const measuredTrailing = (
    <View
      className={stacked ? "max-w-full self-start overflow-hidden" : "min-w-0 shrink"}
      onLayout={(event) => setTrailingWidth(Math.round(event.nativeEvent.layout.width))}
    >
      {trailing}
    </View>
  );
  const title = (
    <>
      {children}
      {supportingText ? (
        <Typography.Paragraph type="body-xs" className="text-grouped-secondary">
          {supportingText}
        </Typography.Paragraph>
      ) : null}
    </>
  );
  const content = (
    <>
      {leading}
      <View className="min-w-0 flex-1 gap-1">
        {title}
        {stacked ? measuredTrailing : null}
      </View>
      {stacked
        ? null
        : measures
          ? measuredTrailing
          : trailing ||
            (onPress && disclosure ? (
              <ChevronRight size={18} color={muted} strokeWidth={1.5} style={MIRROR_IN_RTL} />
            ) : null)}
    </>
  );
  return onPress ? (
    <ListGroup.Item
      accessibilityRole={checked === undefined ? "button" : multiple ? "checkbox" : "radio"}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, checked, expanded }}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      disabled={disabled}
      onPress={() => {
        void haptics.impact("soft");
        onPress();
      }}
      className="min-h-12 flex-row items-center gap-3 px-4 py-3"
      style={({ pressed }) => ({ opacity: disabled ? 0.45 : pressed ? 0.6 : 1 })}
      onLayout={onRowLayout}
    >
      {content}
    </ListGroup.Item>
  ) : (
    <View className="min-h-12 flex-row items-center gap-3 px-4 py-3" onLayout={onRowLayout}>
      {content}
    </View>
  );
}
