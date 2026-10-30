import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ArrowLeft from "lucide-react-native/icons/arrow-left";
import { useCallback } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MobileChatView } from "@/features/chat/components/agent-chat-view";
import { useLeaveChat } from "@/features/chat/components/use-leave-chat";
import { noteChatOpened } from "@/features/quick-actions/model/recent-agents";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

export function AgentChatScreen() {
  const { t } = useText();
  const leaveChat = useLeaveChat();

  const { agentId, messageId } = useLocalSearchParams<{ agentId: string; messageId?: string }>();
  const foreground = useThemeColor("foreground");
  const insets = useSafeAreaInsets();
  const resolvedAgentId = Array.isArray(agentId) ? agentId[0] : agentId;
  const resolvedMessageId = Array.isArray(messageId) ? messageId[0] : messageId;
  // Only this agent: a change elsewhere in the workspace does not render the whole chat again.
  const agent = useMobileWorkspaceSelector((current) =>
    current.agents.find((candidate) => candidate.id === resolvedAgentId),
  );
  const openedAgentId = agent?.id;
  // The app icon offers the chats that the user opened last.
  useFocusEffect(
    useCallback(() => {
      if (openedAgentId) noteChatOpened(openedAgentId);
    }, [openedAgentId]),
  );

  if (agent) {
    return (
      <MobileChatView
        key={`${agent.serverId}:${agent.id}`}
        agent={agent}
        focusMessageId={resolvedMessageId || undefined}
        onLeave={leaveChat}
      />
    );
  }

  return (
    <View
      className="flex-1 items-center justify-center gap-5 bg-background"
      style={{ paddingLeft: insets.left + 32, paddingRight: insets.right + 32 }}
    >
      <Typography.Heading type="h4" align="center">
        {t("mobile.chat.agentUnavailable.title")}
      </Typography.Heading>
      <Typography.Paragraph align="center" className="text-text-secondary">
        {t("mobile.chat.agentUnavailable.body")}
      </Typography.Paragraph>
      <Pressable
        accessibilityRole="button"
        className="min-h-12 flex-row items-center gap-2 rounded-full bg-control px-5"
        onPress={() => {
          void haptics.impact("soft");
          leaveChat();
        }}
      >
        <ArrowLeft color={String(foreground)} size={20} strokeWidth={2} />
        <Typography.Paragraph weight="semibold">{t("mobile.chat.agentUnavailable.goBack")}</Typography.Paragraph>
      </Pressable>
    </View>
  );
}
