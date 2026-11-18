import { Button, Typography } from "heroui-native";
import X from "lucide-react-native/icons/x";
import { useEffect } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { dismissAgentBackdropUndo, undoAgentBackdrop, useChatBackdrop } from "@/features/settings/model/chat-backdrop";
import { GlassCapsule } from "@/shared/components/glass-capsule";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { useText } from "@/shared/lib/text";

const HEIGHT = 40;

/**
 * Tells the reader that the agent of this chat set the backdrop, with Undo, as the desktop toast does.
 * It stays until Undo, its close button, or the reader leaving the chat.
 */
export function ChatBackdropUndo({
  serverId,
  agentId,
  agentName,
  top,
  liquidGlass,
  fallbackBackground,
  foreground,
}: {
  serverId: string;
  agentId: string;
  agentName: string;
  top: number;
  liquidGlass: boolean;
  fallbackBackground: unknown;
  foreground: string;
}) {
  const { t } = useText();
  const reducedMotion = useReducedMotion();
  // Agent ids are per server: the same id on another server is another agent.
  const shown = useChatBackdrop((state) => state.undo?.serverId === serverId && state.undo.agentId === agentId);
  // Leaving the chat ends the offer, as a toast ends on desktop.
  useEffect(
    () => () => {
      const { undo } = useChatBackdrop.getState();
      if (undo?.serverId === serverId && undo.agentId === agentId) dismissAgentBackdropUndo();
    },
    [serverId, agentId],
  );
  if (!shown) return null;
  return (
    <Animated.View
      entering={reducedMotion ? undefined : FadeIn.duration(200)}
      exiting={reducedMotion ? undefined : FadeOut.duration(150)}
      pointerEvents="box-none"
      className="absolute inset-x-0 z-30 items-center"
      style={{ top }}
      accessibilityLiveRegion="polite"
    >
      <GlassCapsule liquidGlass={liquidGlass} fallbackBackground={fallbackBackground} height={HEIGHT}>
        <View className="h-full flex-row items-center gap-1 ps-4 pe-1">
          <Typography type="body-sm" numberOfLines={1} className="shrink">
            {t("mobile.chat.backdrop.agentSet", { name: agentName })}
          </Typography>
          <Button
            size="sm"
            variant="ghost"
            onPress={() => {
              void haptics.selection();
              void undoAgentBackdrop().catch(() => undefined);
            }}
          >
            <Button.Label>{t("mobile.chat.backdrop.undo")}</Button.Label>
          </Button>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("mobile.chat.backdrop.dismiss")}
            hitSlop={8}
            className="size-8 items-center justify-center rounded-full"
            onPress={dismissAgentBackdropUndo}
          >
            <X size={16} color={foreground} strokeWidth={2.2} />
          </Pressable>
        </View>
      </GlassCapsule>
    </Animated.View>
  );
}
