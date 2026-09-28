import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { MessageCircle } from "lucide-react-native";
import { useContext } from "react";
import { Pressable, View } from "react-native";

import { AgentListRow } from "@/features/agents/components/agent-list-row";
import { ChatNavigationGateContext } from "@/features/agents/components/chat-link-pressable";
import type { MobileSearchResult } from "@/features/search/model/mobile-search";
import { formatUpdatedAt } from "@/shared/lib/format-updated-at";
import { useText } from "@/shared/lib/text";

export function MobileSearchResultRow({ result }: { result: MobileSearchResult }) {
  const { t, format } = useText();
  const [muted, controlBackground] = useThemeColor(["muted", "default"]);
  const gate = useContext(ChatNavigationGateContext);
  // Close the sheet and open the chat through its home row in one routing queue run. The chat then
  // has the row's zoom source, so it zooms back into the row when it closes. A chat with no row on
  // the home screen opens with the normal slide.
  const openChat = () => {
    const agentId = result.agent.id;
    router.back();
    if (!gate?.openFromHome(agentId)) router.push({ pathname: "/chat/[agentId]", params: { agentId } });
  };

  if (result.category === "agents") {
    return <AgentListRow agent={result.agent} enableActions={false} onOpen={openChat} />;
  }

  const params = { name: result.agent.name, time: formatUpdatedAt(result.message.createdAt, format) };
  const subtitle =
    result.message.author === "user" ? t("mobile.search.fromYou", params) : t("mobile.search.toYou", params);

  return (
    <Pressable accessibilityRole="button" className="min-h-20 flex-row items-center gap-3 px-5 py-3" onPress={openChat}>
      <View
        className="size-[54px] items-center justify-center rounded-[18px]"
        style={{ backgroundColor: controlBackground }}
      >
        <MessageCircle color={String(muted)} size={24} strokeWidth={1.8} />
      </View>
      <View className="min-w-0 flex-1 gap-1">
        <Typography.Paragraph weight="semibold" numberOfLines={2}>
          {result.text}
        </Typography.Paragraph>
        <Typography.Paragraph type="body-xs" className="text-text-secondary" numberOfLines={1}>
          {subtitle}
        </Typography.Paragraph>
      </View>
    </Pressable>
  );
}
