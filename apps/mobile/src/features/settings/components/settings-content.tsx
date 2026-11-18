import { ListGroup, Typography } from "heroui-native";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import { Children, type PropsWithChildren, type ReactNode, useState } from "react";
import {
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
  type LayoutChangeEvent,
  type ScrollViewProps,
  View,
} from "react-native";
import { useCSSVariable } from "uniwind";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { useFontScale } from "@/shared/lib/font-scale";
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
  rowsDrawSeparators = false,
  children,
}: PropsWithChildren<{
  title?: string;
  footer?: ReactNode;
  /**
   * For rows that can hide themselves, such as a setting that only some hosts serve: the section
   * cannot see which of them render, so each row draws its own separator in `SettingsGroupRow`.
   */
  rowsDrawSeparators?: boolean;
}>) {
  // With `rowsDrawSeparators`, the section stays out of the layout until a row renders, so a title
  // never shows over an empty group while the rows load or after their read fails.
  const [rowsHeight, setRowsHeight] = useState(0);
  const empty = rowsDrawSeparators && rowsHeight === 0;
  return (
    <View
      className="gap-2"
      pointerEvents={empty ? "none" : undefined}
      accessibilityElementsHidden={empty}
      importantForAccessibility={empty ? "no-hide-descendants" : undefined}
      style={empty ? { position: "absolute", left: 0, right: 0, opacity: 0 } : undefined}
    >
      {title ? (
        <Typography type="body-xs" className="px-4 text-grouped-secondary">
          {title}
        </Typography>
      ) : null}
      <ListGroup variant="secondary" className="overflow-hidden rounded-grouped bg-grouped p-0 shadow-none">
        {rowsDrawSeparators ? (
          // The group clips the separator of the first row.
          <View className="-mt-px" onLayout={(event) => setRowsHeight(Math.round(event.nativeEvent.layout.height))}>
            {children}
          </View>
        ) : (
          Children.map(Children.toArray(children), (child, index) =>
            child ? (
              <View>
                {index > 0 ? <View className="ml-4 h-px bg-grouped-border" /> : null}
                {child}
              </View>
            ) : null,
          )
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

/** One row of a `SettingsSection` with `rowsDrawSeparators`, with its separator above it. */
export function SettingsGroupRow({ children }: PropsWithChildren) {
  return (
    <View>
      <View className="ml-4 h-px bg-grouped-border" />
      {children}
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
  description,
  value,
  onPress,
  trailing: trailingControl,
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
  /**
   * Text under the whole row, also under a trailing control. For a longer explanation of a row with
   * a picker or a switch, where `supportingText` beside the control would be narrow.
   */
  description?: ReactNode;
  /** A short value, such as a count, before the disclosure chevron. */
  value?: string;
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
  const chevron =
    onPress && disclosure ? <ChevronRight size={18} color={muted} strokeWidth={1.5} style={MIRROR_IN_RTL} /> : null;
  const trailing = value ? (
    <View className="flex-row items-center gap-2">
      <Typography.Paragraph className="text-grouped-secondary">{value}</Typography.Paragraph>
      {chevron}
    </View>
  ) : (
    trailingControl
  );
  const fontScale = useFontScale();
  const measures = Boolean(trailing) && fontScale >= STACKED_FONT_SCALE;
  const [rowWidth, setRowWidth] = useState(0);
  const [trailingWidth, setTrailingWidth] = useState(0);
  const stacked = measures && rowWidth > 0 && trailingWidth > (rowWidth - ROW_PADDING_X) * STACKED_VALUE_SHARE;
  const onRowLayout = measures
    ? (event: LayoutChangeEvent) => setRowWidth(Math.round(event.nativeEvent.layout.width))
    : undefined;
  const trailingContent = trailing || chevron;
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
  // The title and the value keep one place in the tree in all layouts; only the styles change. If
  // the value moved to another parent, React would mount a new native control, which is narrow
  // until it measures its contents. The row would then change its layout again at each mount and
  // flicker.
  const body = (
    <View className={stacked ? "min-w-0 flex-1 gap-1" : "min-w-0 flex-1 flex-row items-center gap-3"}>
      <View className={stacked ? "gap-1" : "min-w-0 flex-1 gap-1"}>{title}</View>
      {trailingContent ? (
        // The value limit is a part of this row, which has a fixed width. A percent limit inside the
        // value would refer to this wrapper, which takes the width of its contents.
        <View
          className={stacked ? "max-w-full self-start overflow-hidden" : "min-w-0 max-w-[60%] shrink"}
          onLayout={measures ? (event) => setTrailingWidth(Math.round(event.nativeEvent.layout.width)) : undefined}
        >
          {trailingContent}
        </View>
      ) : null}
    </View>
  );
  // `ListGroup.Item` lays out its children in a row, so the description shares one column with the
  // row content, after the icon, so that it lines up with the title.
  // The icon shares a line with the title, so both center on it. A 20 pt icon and the 12 pt gap put
  // the description under the title.
  const content = description ? (
    <View className="min-w-0 flex-1 gap-0.5">
      <View className="min-w-0 flex-row items-center gap-3">
        {leading}
        {body}
      </View>
      <Typography.Paragraph
        type="body-xs"
        className={leading ? "pl-8 text-grouped-secondary" : "text-grouped-secondary"}
      >
        {description}
      </Typography.Paragraph>
    </View>
  ) : (
    <>
      {leading}
      {body}
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
    <View
      accessibilityState={disabled ? { disabled } : undefined}
      className="min-h-12 flex-row items-center gap-3 px-4 py-3"
      // The same dimming as a disabled row with an action, such as a row with a picker.
      style={disabled ? { opacity: 0.45 } : undefined}
      onLayout={onRowLayout}
    >
      {content}
    </View>
  );
}
