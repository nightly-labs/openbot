import type { ChannelSummary } from "@openbot/contracts/ipc";
import { useThemeColor } from "heroui-native/hooks";
import { Folder } from "lucide-react-native";
import { memo } from "react";
import { View } from "react-native";
import { BloubAvatarThumbnail } from "@/features/agents/components/bloub-avatar";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";

export const ChannelAvatar = memo(function ChannelAvatar({
  channel,
  agents,
  size,
  disconnected = false,
}: {
  channel: Pick<ChannelSummary, "members">;
  agents: ReadonlyMap<string, MobileAgent>;
  size: number;
  disconnected?: boolean;
}) {
  const members = channel.members.slice(0, 4);
  const muted = useThemeColor("muted");
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        flexDirection: "row",
        flexWrap: "wrap",
        alignContent: "center",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
      }}
    >
      {!members.length ? <Folder color={String(muted)} size={size * 0.56} /> : null}
      {members.map((member) => {
        const agent = agents.get(member.agentId);
        return (
          <BloubAvatarThumbnail
            key={member.agentId}
            agentId={agent?.id}
            serverId={agent?.serverId}
            disconnected={disconnected}
            seed={agent?.avatarSeed ?? member.agentId}
            hue={agent?.avatarHue ?? null}
            size={(size - 6) / 2}
          />
        );
      })}
    </View>
  );
});
