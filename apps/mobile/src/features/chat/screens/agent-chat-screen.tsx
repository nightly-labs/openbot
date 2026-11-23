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

  const { agentId, serverId, messageId, focusAt } = useLocalSearchParams<{
    agentId: string;
    serverId?: string;
    messageId?: string;
    focusAt?: string;
  }>();
  const foreground = useThemeColor("foreground");
  const insets = useSafeAreaInsets();
  const resolvedAgentId = firstParam(agentId);
  const resolvedServerId = firstParam(serverId);
  const resolvedMessageId = firstParam(messageId);
  const agent = useMobileWorkspaceSelector(
    (current) => findChatAgent(current.agents, resolvedAgentId, resolvedServerId, current.activeServer.id),
    sameChatAgent,
  );
  const openedAgentId = agent?.id;
  useFocusEffect(
    useCallback(() => {
      if (openedAgentId) noteChatOpened(openedAgentId);
    }, [openedAgentId]),
  );

  if (agent) {
    return (
      <MobileChatView
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

function findChatAgent(
  agents: readonly MobileAgent[],
  agentId: string | undefined,
  serverId: string | undefined,
  activeServerId: string,
): MobileAgent | undefined {
  const withId = agents.filter((agent) => agent.id === agentId);
  if (serverId) return withId.find((agent) => agent.serverId === serverId);
  return withId.find((agent) => agent.serverId === activeServerId) ?? withId[0];
}

function sameChatAgent(previous: MobileAgent | undefined, next: MobileAgent | undefined): boolean {
  return previous !== undefined && next !== undefined && sameAgentApartFromMessage(previous, next);
}
