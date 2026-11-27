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
  rowsDrawSeparators?: boolean;
}>) {
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

const STACKED_FONT_SCALE = 1.3;
const STACKED_VALUE_SHARE = 0.4;
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
  description?: ReactNode;
  value?: string;
  onPress?: () => void;
  trailing?: ReactNode;
  disabled?: boolean;
  leading?: ReactNode;
  disclosure?: boolean;
  accessibilityLabel?: string;
  checked?: boolean;
  multiple?: boolean;
  expanded?: boolean;
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
  const body = (
    <View className={stacked ? "min-w-0 flex-1 gap-1" : "min-w-0 flex-1 flex-row items-center gap-3"}>
      <View className={stacked ? "gap-1" : "min-w-0 flex-1 gap-1"}>{title}</View>
      {trailingContent ? (
        <View
          className={stacked ? "max-w-full self-start overflow-hidden" : "min-w-0 max-w-[60%] shrink"}
          onLayout={measures ? (event) => setTrailingWidth(Math.round(event.nativeEvent.layout.width)) : undefined}
        >
          {trailingContent}
        </View>
      ) : null}
    </View>
  );
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
      style={disabled ? { opacity: 0.45 } : undefined}
      onLayout={onRowLayout}
    >
      {content}
    </View>
  );
}
