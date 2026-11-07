import { SELECTION_ACTION_INSTRUCTIONS, type SelectionAction } from "@openbot/contracts/selection-instruction";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { Typography } from "heroui-native";
import { useEffect, useState } from "react";
import { ScrollView, type ViewStyle } from "react-native";
import Animated, { cubicBezier } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReducedMotion } from "@/shared/lib/motion";
import { useText } from "@/shared/lib/text";
import { ChatGlassButton } from "./chat-glass-icon-button";

const EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);
/** The time of the glass fade in `ChatGlassButton`, so the row leaves with its glass. */
const PRESENCE_MS = 200;
/** Each capsule starts this much after the one before it, from the left. */
const STAGGER_MS = 30;
const CAPSULE_HEIGHT = 40;

const ACTIONS: readonly { action: SelectionAction; label: MobileTextKey }[] = [
  { action: "Explain", label: "mobile.chat.selection.explain" },
  { action: "Improve", label: "mobile.chat.selection.improve" },
  { action: "Shorten", label: "mobile.chat.selection.shorten" },
  { action: "Tone", label: "mobile.chat.selection.tone" },
  { action: "Grammar", label: "mobile.chat.selection.grammar" },
];

/**
 * Keeps the bar mounted while it leaves. `shown` turns on one frame after the mount, so the glass
 * and the slide have a start state to animate from.
 */
function usePresence(visible: boolean) {
  const [mounted, setMounted] = useState(visible);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (visible) {
      setMounted(true);
      const frame = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(frame);
    }
    setShown(false);
    const timer = setTimeout(() => setMounted(false), PRESENCE_MS);
    return () => clearTimeout(timer);
  }, [visible]);
  return { mounted, shown };
}

/**
 * The actions for text selected in a message, as glass capsules above the composer. Each one sends
 * at once as a reply to the message, as the desktop selection bar does. To describe an edit, the
 * reader writes it in the composer, which then sends it with the same quote. The selection ends
 * with a tap outside the message or a second tap on Select text, so the bar has no close button.
 *
 * iOS draws no glass under a parent with an opacity below 1, so the bar does not fade as a whole:
 * each capsule fades its own glass, and the row moves with a transform only.
 */
export function ChatSelectionBar({
  visible,
  canSend,
  liquidGlassAvailable,
  fallbackBackground,
  onAction,
}: {
  visible: boolean;
  canSend: boolean;
  liquidGlassAvailable: boolean;
  fallbackBackground: ViewStyle["backgroundColor"];
  onAction: (instruction: string) => void;
}) {
  const { t } = useText();
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { mounted, shown } = usePresence(visible);
  if (!mounted) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      accessibilityLabel={t("mobile.chat.selection.label")}
      accessibilityElementsHidden={!shown}
      importantForAccessibility={shown ? "auto" : "no-hide-descendants"}
      className="pb-2"
      contentContainerClassName="gap-2"
      // The row scrolls from edge to edge; its ends keep clear of the side insets.
      contentContainerStyle={{ paddingLeft: insets.left + 16, paddingRight: insets.right + 16 }}
    >
      {ACTIONS.map(({ action, label }, index) => (
        <Animated.View
          key={action}
          style={{
            // Reduced motion keeps the glass fade and drops the movement.
            transform: [{ translateY: shown || reducedMotion ? 0 : 8 }, { scale: shown || reducedMotion ? 1 : 0.97 }],
            transitionProperty: "transform",
            transitionDuration: PRESENCE_MS,
            // In from the left one after another; out all together, so leaving is quick.
            transitionDelay: shown ? index * STAGGER_MS : 0,
            transitionTimingFunction: EASE_OUT,
          }}
        >
          <ChatGlassButton
            accessibilityLabel={t(label)}
            className="h-10 flex-row items-center px-3.5"
            disabled={!canSend}
            fallbackBackground={fallbackBackground}
            height={CAPSULE_HEIGHT}
            hidden={!shown}
            liquidGlassAvailable={liquidGlassAvailable}
            onPress={() => onAction(SELECTION_ACTION_INSTRUCTIONS[action])}
          >
            <Typography.Paragraph type="body-sm" weight="semibold">
              {t(label)}
            </Typography.Paragraph>
          </ChatGlassButton>
        </Animated.View>
      ))}
    </ScrollView>
  );
}
