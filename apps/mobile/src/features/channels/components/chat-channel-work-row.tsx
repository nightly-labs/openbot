import type { ChannelSummary } from "@openbot/contracts/ipc";
import { Spinner, Typography } from "heroui-native";
import { Pressable, View } from "react-native";
import { useCSSVariable } from "uniwind";
import { useChatNavigation } from "@/features/chat/context/chat-navigation-context";
import type { MobileAgentActivity } from "@/features/workspace/model/agent-activity";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { waitingChannelHref } from "./use-waiting-channel";

export function ChatChannelWorkRow({
  channel,
  activity,
  agentId,
  serverId,
}: {
  channel: ChannelSummary;
  activity: MobileAgentActivity;
  agentId: string;
  serverId: string;
}) {
  const { t } = useText();
  const navigation = useChatNavigation();
  const accent = useCSSVariable("--openbot-accent-text");
  const label = t(
    activity.phase === "waiting" ? "mobile.chat.channelWork.waiting" : "mobile.chat.channelWork.working",
    {
      channel: channel.name,
    },
  );
  return (
    <View className="items-start pb-3">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("mobile.chat.channelWork.open", { label })}
        className="max-w-[88%] flex-row items-center gap-3 rounded-[18px] border border-separator bg-control/60 px-3.5 py-2.5"
        style={({ pressed }) => ({ borderCurve: "continuous", opacity: pressed ? 0.6 : 1 })}
        onPress={() => {
          void haptics.selection();
          navigation.push(waitingChannelHref(channel.id, serverId, agentId, activity));
        }}
      >
        {activity.phase === "waiting" ? null : <Spinner size="sm" color={String(accent)} />}
        <Typography.Paragraph weight="semibold" numberOfLines={2} className="shrink">
          {label}
        </Typography.Paragraph>
      </Pressable>
    </View>
  );
}
