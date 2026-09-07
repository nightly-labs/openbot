import { ListGroup, Typography } from "heroui-native";
import { ChevronRight } from "lucide-react-native";
import { Children, type PropsWithChildren, type ReactNode } from "react";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";

export function SettingsContent({ children }: PropsWithChildren) {
  return (
    <SheetScrollView
      scrollEdgeEffect={false}
      contentContainerClassName="gap-7 px-4 pb-safe-offset-5 pt-5"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </SheetScrollView>
  );
}

export function SettingsSection({ title, children }: PropsWithChildren<{ title?: string }>) {
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

export function SettingsRow({
  children,
  supportingText,
  onPress,
  trailing,
  disabled = false,
  leading,
  disclosure = true,
}: PropsWithChildren<{
  supportingText?: string;
  onPress?: () => void;
  trailing?: ReactNode;
  disabled?: boolean;
  leading?: ReactNode;
  disclosure?: boolean;
}>) {
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const content = (
    <>
      {leading}
      <View className="min-w-0 flex-1 gap-1">
        {children}
        {supportingText ? (
          <Typography.Paragraph type="body-xs" className="text-grouped-secondary">
            {supportingText}
          </Typography.Paragraph>
        ) : null}
      </View>
      {trailing || (onPress && disclosure ? <ChevronRight size={18} color={muted} strokeWidth={1.5} /> : null)}
    </>
  );
  return onPress ? (
    <ListGroup.Item
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className="min-h-12 flex-row items-center gap-3 px-4 py-3"
      style={({ pressed }) => ({ opacity: disabled ? 0.45 : pressed ? 0.6 : 1 })}
    >
      {content}
    </ListGroup.Item>
  ) : (
    <View className="min-h-12 flex-row items-center gap-3 px-4 py-3">{content}</View>
  );
}
