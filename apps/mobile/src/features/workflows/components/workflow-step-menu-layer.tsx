import { useRef } from "react";
import { type AccessibilityActionInfo, Pressable, StyleSheet } from "react-native";
import { useUniwind } from "uniwind";
import { type MenuAction, type MenuComponentRef, MenuView } from "@/shared/components/menu-view";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid, longPressDelay } from "@/shared/lib/platform";

/** The actions of a menu with their inline groups opened, for VoiceOver and TalkBack. */
function flatActions(actions: readonly MenuAction[]): AccessibilityActionInfo[] {
  return actions.flatMap((action) =>
    action.subactions?.length
      ? flatActions(action.subactions)
      : action.id
        ? [{ name: action.id, label: action.title }]
        : [],
  );
}

/**
 * A menu over a step: a clear layer the size of the step. The step's text is not inside the menu
 * host: on iOS that host gives its content all the width it asks for, so a long text did not wrap and
 * ran past the card or was cut at the edge of the screen.
 *
 * Without `onPress`, a tap opens the menu. With `onPress`, a tap does that and a long press opens the
 * menu, as on a step of the editor.
 */
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
  /** Names the step for VoiceOver and TalkBack. */
  label: string;
  hint?: string | undefined;
  /** The size of the step, from its layout; the layer waits for it. */
  size: { width: number; height: number } | undefined;
  onAction: (id: string) => void;
  onPress?: (() => void) | undefined;
  /** The step shows that it is pressed. */
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
        // The native context menu does not cancel this touch. Without a long-press handler, lifting the
        // finger after the menu opens counts as a tap.
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
