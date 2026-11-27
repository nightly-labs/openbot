import { avatarHueSwatch } from "@openbot/brand/bloub-avatar";
import type { AvatarHue, ChannelIconName, ChannelSummary } from "@openbot/contracts/ipc";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Folder from "lucide-react-native/icons/folder";
import { memo, type ReactNode, useState } from "react";
import { View } from "react-native";
import { BloubAvatarThumbnail } from "@/features/agents/components/bloub-avatar";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { DISCONNECTED_APPEARANCE } from "@/features/workspace/components/use-connection-appearance";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { savedChannelImage } from "@/features/workspace/model/agent-avatar-cache";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { showsOnline } from "@/features/workspace/model/server-status";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { useText } from "@/shared/lib/text";
import { CHANNEL_ICONS, knownChannelIcon } from "../model/channel-icons";

const CELLS = 4;
const PITCH = 0.34;
const FACE = 0.63;
const COUNT = 0.46;

type Cell = readonly [x: number, y: number];
const LEFT = -PITCH / 2;
const RIGHT = PITCH / 2;
const TOP = -PITCH / 2;
const BOTTOM = PITCH / 2;
const LAYOUTS: Readonly<Record<number, readonly Cell[]>> = {
  2: [
    [LEFT, 0],
    [RIGHT, 0],
  ],
  3: [
    [LEFT, TOP],
    [RIGHT, TOP],
    [0, BOTTOM],
  ],
  4: [
    [LEFT, TOP],
    [RIGHT, TOP],
    [LEFT, BOTTOM],
    [RIGHT, BOTTOM],
  ],
};

const PICTURE_RADIUS = 0.3;

type ChannelPictureSource = Pick<ChannelSummary, "members"> & Partial<Pick<ChannelSummary, "id" | "icon" | "imageUrl">>;

export const ChannelAvatar = memo(function ChannelAvatar({
  channel,
  agents,
  size,
  serverId,
  disconnected = false,
}: {
  channel: ChannelPictureSource;
  agents: ReadonlyMap<string, MobileAgent>;
  size: number;
  serverId?: string;
  disconnected?: boolean;
}) {
  const icon = knownChannelIcon(channel.icon);
  const fallback = icon ? (
    <ChannelIconTile name={icon.name} hue={icon.hue} size={size} disconnected={disconnected} />
  ) : (
    <MemberFaces channel={channel} agents={agents} size={size} disconnected={disconnected} />
  );
  if (!channel.imageUrl || !channel.id || !serverId) return fallback;
  return (
    <ChannelImage
      serverId={serverId}
      channelId={channel.id}
      imageUrl={channel.imageUrl}
      size={size}
      disconnected={disconnected}
    >
      {fallback}
    </ChannelImage>
  );
});

export function ChannelIconTile({
  name,
  hue,
  size,
  disconnected = false,
}: {
  name: ChannelIconName;
  hue: AvatarHue;
  size: number;
  disconnected?: boolean;
}) {
  const swatch = avatarHueSwatch(hue);
  const Glyph = CHANNEL_ICONS[name].glyph;
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size * PICTURE_RADIUS,
        borderCurve: "continuous",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: `${swatch}42`,
        opacity: disconnected ? DISCONNECTED_APPEARANCE.opacity : 1,
      }}
    >
      <Glyph color={swatch} size={size * 0.55} strokeWidth={2} />
    </View>
  );
}

function ChannelImage({
  serverId,
  channelId,
  imageUrl,
  size,
  disconnected,
  children,
}: {
  serverId: string;
  channelId: string;
  imageUrl: string;
  size: number;
  disconnected: boolean;
  children: ReactNode;
}) {
  const { channelStore } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const online = useMobileWorkspaceSelector((current) =>
    current.servers.some((server) => server.id === serverId && showsOnline(server)),
  );
  const image = useQuery({
    queryKey: queryKeys.channelImage(queryScope, serverId, channelId, imageUrl),
    enabled: online,
    queryFn: () => channelStore.image(serverId, channelId, imageUrl),
    initialData: () => savedChannelImage(serverId, channelId, imageUrl) ?? undefined,
    staleTime: Infinity,
  });
  const [failed, setFailed] = useState<string | null>(null);
  const uri = image.data;
  if (!uri || uri === failed) return children;
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size * PICTURE_RADIUS,
        borderCurve: "continuous",
        overflow: "hidden",
      }}
    >
      <Image
        source={{ uri }}
        contentFit="cover"
        recyclingKey={uri}
        style={{ width: size, height: size, opacity: disconnected ? DISCONNECTED_APPEARANCE.opacity : 1 }}
        onError={() => setFailed(uri)}
      />
    </View>
  );
}

const MemberFaces = memo(function MemberFaces({
  channel,
  agents,
  size,
  disconnected,
}: {
  channel: Pick<ChannelSummary, "members">;
  agents: ReadonlyMap<string, MobileAgent>;
  size: number;
  disconnected: boolean;
}) {
  const muted = useThemeColor("muted");
  const total = channel.members.length;
  const faceCount = total <= CELLS ? total : total - (CELLS - 1) >= 10 ? CELLS - 2 : CELLS - 1;
  const hidden = total - faceCount;
  const single = total === 1;
  const face = single ? size : Math.round(size * FACE);
  const cells = LAYOUTS[hidden > 0 ? faceCount + 1 : faceCount] ?? [[0, 0]];
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
    >
      {!total ? <Folder color={String(muted)} size={size * 0.56} /> : null}
      {channel.members.slice(0, faceCount).map((member, index) => {
        const agent = agents.get(member.agentId);
        const [x, y] = cells[index] ?? [0, 0];
        return (
          <View
            key={member.agentId}
            style={{
              position: "absolute",
              left: size / 2 + x * size - face / 2,
              top: size / 2 + y * size - face / 2,
            }}
          >
            <BloubAvatarThumbnail
              agentId={agent?.id}
              serverId={agent?.serverId}
              disconnected={disconnected}
              seed={agent?.avatarSeed ?? member.agentId}
              hue={agent?.avatarHue ?? null}
              color={agent?.avatarColor ?? null}
              size={face}
            />
          </View>
        );
      })}
      {hidden > 0 ? <HiddenCount count={hidden} size={size} cell={cells[faceCount] ?? [0, 0]} /> : null}
    </View>
  );
});

function HiddenCount({ count, size, cell }: { count: number; size: number; cell: Cell }) {
  const { t, format } = useText();
  const disc = Math.round(size * COUNT);
  const [x, y] = cell;
  const fontSize = Math.max(8, Math.round(disc * 0.55));
  return (
    <View
      style={{
        position: "absolute",
        left: count >= 10 ? 0 : size / 2 + x * size - disc / 2,
        width: count >= 10 ? size : disc,
        top: size / 2 + y * size - disc / 2,
        alignItems: "center",
      }}
    >
      <View
        className="bg-default"
        style={{
          minWidth: disc,
          height: disc,
          paddingHorizontal: 1,
          borderRadius: disc / 2,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Typography
          type="body-xs"
          className="font-semibold text-text-secondary"
          style={{ fontSize, lineHeight: fontSize * 1.2, fontVariant: ["tabular-nums"], letterSpacing: -0.4 }}
          numberOfLines={1}
        >
          {t("mobile.channel.avatar.more", { count: format.number(count) })}
        </Typography>
      </View>
    </View>
  );
}
