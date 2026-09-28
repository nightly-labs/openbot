import { router, useLocalSearchParams, usePreventZoomTransitionDismissal } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { ArrowLeft } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { MobileChatView } from "@/features/chat/components/agent-chat-view";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { useText } from "@/shared/lib/text";

export function AgentChatScreen() {
  const { t } = useText();
  usePreventZoomTransitionDismissal({
    unstable_dismissalBoundsRect: { minX: 0, maxX: 24 },
  });

  const { agentId } = useLocalSearchParams<{ agentId: string }>();
  const { agents } = useMobileWorkspace();
  const foreground = useThemeColor("foreground");
  const resolvedAgentId = Array.isArray(agentId) ? agentId[0] : agentId;
  const agent = agents.find((candidate) => candidate.id === resolvedAgentId);

  if (agent) {
    return <MobileChatView key={`${agent.serverId}:${agent.id}`} agent={agent} />;
  }

  return (
    <View className="flex-1 items-center justify-center gap-5 bg-background px-8">
      <Typography.Heading type="h4" align="center">
        {t("mobile.chat.agentUnavailable.title")}
      </Typography.Heading>
      <Typography.Paragraph align="center" className="text-text-secondary">
        {t("mobile.chat.agentUnavailable.body")}
      </Typography.Paragraph>
      <Pressable
        accessibilityRole="button"
        className="min-h-12 flex-row items-center gap-2 rounded-full bg-control px-5"
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/connected"))}
      >
        <ArrowLeft color={String(foreground)} size={20} strokeWidth={2} />
        <Typography.Paragraph weight="semibold">{t("mobile.chat.agentUnavailable.goBack")}</Typography.Paragraph>
      </Pressable>
    </View>
  );
}
