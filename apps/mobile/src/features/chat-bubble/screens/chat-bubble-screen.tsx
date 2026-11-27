import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import X from "lucide-react-native/icons/x";
import { useEffect, useMemo } from "react";
import { Pressable, View } from "react-native";
import { MobileChatView } from "@/features/chat/components/agent-chat-view";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { findChatAgent } from "@/features/workspace/model/directory-agents";
import { useText } from "@/shared/lib/text";
import { chatBubbleNative } from "../chat-bubble-native";

export function ChatBubbleHeader({ title }: { title: string }) {
  const { t } = useText();
  const foreground = useThemeColor("foreground");
  return (
    <View className="flex-row items-center gap-3 px-4 pb-2 pt-safe-offset-3">
      <Typography.Heading type="h5" className="flex-1" numberOfLines={1}>
        {title}
      </Typography.Heading>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("mobile.settings.chatBubble.close")}
        hitSlop={12}
        className="size-8 items-center justify-center rounded-full"
        onPress={() => chatBubbleNative?.close()}
      >
        <X size={18} color={foreground} strokeWidth={2.2} />
      </Pressable>
    </View>
  );
}

export function ChatBubbleScreen() {
  const { t } = useText();
  const target = useMemo(() => chatBubbleNative?.currentTarget() ?? null, []);
  const agents = useMobileWorkspaceSelector((current) => current.agents);
  const activeServerId = useMobileWorkspaceSelector((current) => current.activeServer.id);
  const markAgentRead = useMobileWorkspaceSelector((current) => current.markAgentRead);
  const agent = target ? findChatAgent(agents, target.agentId, target.serverId, activeServerId) : undefined;

  useEffect(() => {
    if (agent) markAgentRead(agent.id, undefined, agent.serverId);
  }, [agent, markAgentRead]);

  return (
    <View className="flex-1 bg-background">
      <ChatBubbleHeader title={agent?.name ?? t("mobile.settings.chatBubble.title")} />
      {agent ? (
        <MobileChatView agent={agent} onLeave={() => chatBubbleNative?.close()} />
      ) : (
        <Typography.Paragraph type="body-sm" className="px-4 text-muted">
          {t("mobile.settings.chatBubble.noAgent")}
        </Typography.Paragraph>
      )}
    </View>
  );
}
