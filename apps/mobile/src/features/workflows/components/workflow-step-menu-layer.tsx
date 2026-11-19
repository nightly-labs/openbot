import { useRef } from "react";
import { type AccessibilityActionInfo, Pressable, StyleSheet } from "react-native";
import { useUniwind } from "uniwind";
import { type MenuAction, type MenuComponentRef, MenuView } from "@/shared/components/menu-view";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid, longPressDelay } from "@/shared/lib/platform";

function flatActions(actions: readonly MenuAction[]): AccessibilityActionInfo[] {
  return actions.flatMap((action) =>
    action.subactions?.length
      ? flatActions(action.subactions)
      : action.id
        ? [{ name: action.id, label: action.title }]
        : [],
  );
}

export function WorkflowStepMenuLayer({
  actions,
  label,
  hint,
  size,
  onAction,
  onPress,
  onPressedChange,
}: {
  actions: MenuAction[];
  label: string;
  hint?: string | undefined;
  size: { width: number; height: number } | undefined;
  onAction: (id: string) => void;
  onPress?: (() => void) | undefined;
  onPressedChange?: ((pressed: boolean) => void) | undefined;
}) {
  const { theme } = useUniwind();
  const ref = useRef<MenuComponentRef | null>(null);
  if (!size) return null;
  const longPress = Boolean(onPress);
  return (
    <MenuView
      {...(isAndroid ? { ref, colorScheme: theme === "dark" ? ("dark" as const) : ("light" as const) } : null)}
      shouldOpenOnLongPress={longPress}
      actions={actions}
      onPressAction={(event) => onAction(event.nativeEvent.event)}
      style={[StyleSheet.absoluteFill, size]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityActions={longPress ? flatActions(actions) : undefined}
        onAccessibilityAction={(event) => onAction(event.nativeEvent.actionName)}
        style={size}
        onPressIn={() => onPressedChange?.(true)}
        onPressOut={() => onPressedChange?.(false)}
        onPress={() => {
          if (onPress) onPress();
          else if (isAndroid) ref.current?.show();
        }}
        delayLongPress={longPressDelay}
        onLongPress={
          longPress
            ? () => {
                void haptics.longPress();
                if (isAndroid) ref.current?.show();
              }
            : undefined
        }
      />
    </MenuView>
  );
}
