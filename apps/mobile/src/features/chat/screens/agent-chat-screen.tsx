import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ArrowLeft from "lucide-react-native/icons/arrow-left";
import { useCallback } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MobileChatView } from "@/features/chat/components/agent-chat-view";
import { firstParam } from "@/features/chat/components/use-conversation-message";
import { useLeaveChat } from "@/features/chat/components/use-leave-chat";
import { noteChatOpened } from "@/features/quick-actions/model/recent-agents";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { sameAgentApartFromMessage } from "@/features/workspace/model/directory-agents";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { MIRROR_IN_RTL } from "@/shared/lib/text-direction";

export function AgentChatScreen() {
  const { t } = useText();
  const leaveChat = useLeaveChat();

  // `focusAt` changes when a pinned message opens again, so the chat goes to it again.
  const { agentId, messageId, focusAt } = useLocalSearchParams<{
    agentId: string;
    messageId?: string;
    focusAt?: string;
  }>();
  const foreground = useThemeColor("foreground");
  const insets = useSafeAreaInsets();
  const resolvedAgentId = firstParam(agentId);
  const resolvedMessageId = firstParam(messageId);
  // Only this agent: a change elsewhere in the workspace does not render the whole chat again. The
  // chat does not show the agent's latest message preview, so a new message keeps the same agent.
  const agent = useMobileWorkspaceSelector(
    (current) => current.agents.find((candidate) => candidate.id === resolvedAgentId),
    sameChatAgent,
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
        // A new message, such as the source of a branch, opens the chat again at that message.
        key={`${agent.serverId}:${agent.id}:${resolvedMessageId ?? ""}:${focusAt ?? ""}`}
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
        <ArrowLeft color={String(foreground)} size={20} strokeWidth={2} style={MIRROR_IN_RTL} />
        <Typography.Paragraph weight="semibold">{t("mobile.chat.agentUnavailable.goBack")}</Typography.Paragraph>
      </Pressable>
    </View>
  );
}

function sameChatAgent(previous: MobileAgent | undefined, next: MobileAgent | undefined): boolean {
  return previous !== undefined && next !== undefined && sameAgentApartFromMessage(previous, next);
}
