import type { ChannelSummary } from "@openbot/contracts/ipc";
import { router } from "expo-router";
import { Spinner, Typography } from "heroui-native";
import { Pressable, View } from "react-native";
import { useCSSVariable } from "uniwind";
import type { MobileAgentActivity } from "@/features/workspace/model/agent-activity";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/**
 * Under the agent chat, while the agent works in a channel: the channel turn does not show in this
 * chat, as on desktop, so this card says where the agent works. A tap opens the channel, where the
 * person answers a question, an approval or a browser step of that work.
 */
export function ChatChannelWorkRow({
  channel,
  activity,
  serverId,
}: {
  channel: ChannelSummary;
  activity: MobileAgentActivity;
  serverId: string;
}) {
  const { t } = useText();
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
          router.push({ pathname: "/channel/[channelId]", params: { channelId: channel.id, serverId } });
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
