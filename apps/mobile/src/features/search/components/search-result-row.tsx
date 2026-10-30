import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import type { LucideIcon } from "lucide-react-native";
import Bell from "lucide-react-native/icons/bell";
import CalendarClock from "lucide-react-native/icons/calendar-clock";
import ChartColumn from "lucide-react-native/icons/chart-column";
import EyeOff from "lucide-react-native/icons/eye-off";
import FileIcon from "lucide-react-native/icons/file";
import FileImage from "lucide-react-native/icons/file-image";
import FileText from "lucide-react-native/icons/file-text";
import Info from "lucide-react-native/icons/info";
import Languages from "lucide-react-native/icons/languages";
import LifeBuoy from "lucide-react-native/icons/life-buoy";
import MonitorSmartphone from "lucide-react-native/icons/monitor-smartphone";
import Palette from "lucide-react-native/icons/palette";
import Radio from "lucide-react-native/icons/radio";
import Server from "lucide-react-native/icons/server";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import Sparkles from "lucide-react-native/icons/sparkles";
import Trash2 from "lucide-react-native/icons/trash";
import UserRound from "lucide-react-native/icons/user-round";
import UsersRound from "lucide-react-native/icons/users-round";
import Vibrate from "lucide-react-native/icons/vibrate";
import { type ReactNode, useContext, useMemo } from "react";
import { Pressable, View } from "react-native";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { ChatNavigationGateContext } from "@/features/agents/components/chat-link-pressable";
import { openChatFromPane, useChatListPane } from "@/features/agents/components/chat-list-pane-context";
import { ChannelAvatar } from "@/features/channels/components/channel-avatar";
import {
  type MobileSearchResult,
  type MobileSearchSettingId,
  mobileSearchMatchParts,
  mobileSearchSnippet,
} from "@/features/search/model/mobile-search";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";
import { formatUpdatedAt } from "@/shared/lib/format-updated-at";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

const AVATAR_SIZE = 44;

/** Shows the runs of `text` that match the query in the primary color, as the desktop search does. */
function Highlighted({ text, query }: { text: string; query: string }) {
  let start = 0;
  return mobileSearchMatchParts(text, query).map((part) => {
    // The offset of a part in the text names it.
    const key = start;
    start += part.text.length;
    return part.match ? (
      <Typography.Paragraph key={key} className="font-medium text-foreground" style={typeScale.preview}>
        {part.text}
      </Typography.Paragraph>
    ) : (
      part.text
    );
  });
}

function SearchRow({
  leading,
  title,
  detail,
  detailLines = 1,
  trailing,
  query,
  onPress,
}: {
  leading: ReactNode;
  title: string;
  detail?: string;
  detailLines?: number;
  trailing?: string;
  query: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      className="min-h-16 flex-row items-center gap-3 px-5 py-2"
      style={({ pressed }) => ({ opacity: pressed ? 0.58 : 1 })}
      onPress={() => {
        void haptics.impact("soft");
        onPress();
      }}
    >
      {leading}
      <View className="min-w-0 flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Typography.Paragraph className="font-semibold min-w-0 flex-1" numberOfLines={1} style={typeScale.rowTitle}>
            {title}
          </Typography.Paragraph>
          {trailing ? (
            <Typography.Paragraph className="text-muted" style={typeScale.caption}>
              {trailing}
            </Typography.Paragraph>
          ) : null}
        </View>
        {detail ? (
          <Typography.Paragraph className="text-text-secondary" numberOfLines={detailLines} style={typeScale.preview}>
            <Highlighted text={detail} query={query} />
          </Typography.Paragraph>
        ) : null}
      </View>
    </Pressable>
  );
}

/** An icon in the place of an avatar, so the text of every row starts at the same line. */
function RowIcon({ icon: Icon }: { icon: LucideIcon }) {
  const muted = useThemeColor("muted");
  return (
    <View className="size-11 items-center justify-center">
      <Icon color={String(muted)} size={24} strokeWidth={1.8} />
    </View>
  );
}

function AgentAvatar({ agent }: { agent: MobileAgent }) {
  return (
    <BloubAvatar
      agentId={agent.id}
      serverId={agent.serverId}
      hue={agent.avatarHue}
      seed={agent.avatarSeed}
      size={AVATAR_SIZE}
      animateIdle={false}
    />
  );
}

const SETTING_ICON = {
  profile: UserRound,
  sessions: MonitorSmartphone,
  appearance: Palette,
  animations: Sparkles,
  language: Languages,
  haptics: Vibrate,
  notifications: Bell,
  liveActivities: Radio,
  privacy: ShieldCheck,
  hiddenChats: EyeOff,
  deletedChannels: Trash2,
  support: LifeBuoy,
  about: Info,
  serverOptions: Server,
  serverMembers: UsersRound,
  serverRoutines: CalendarClock,
  serverUsage: ChartColumn,
} as const satisfies Record<MobileSearchSettingId, LucideIcon>;

/** Opens a settings page in its sheet. The sheet stack puts its first page under it, for the back button. */
function openSetting(id: MobileSearchSettingId, serverId: string) {
  switch (id) {
    case "profile":
      return router.push("/settings/profile");
    case "sessions":
      return router.push("/settings/sessions");
    case "appearance":
      return router.push("/settings/appearance");
    case "animations":
      return router.push("/settings/animations");
    case "language":
      return router.push("/settings/language");
    case "haptics":
      return router.push("/settings/haptics");
    // One page has the notification and the Live Activity settings.
    case "notifications":
    case "liveActivities":
      return router.push("/settings/notifications");
    case "privacy":
      return router.push("/settings/privacy");
    case "hiddenChats":
      return router.push("/settings/hidden-chats");
    case "deletedChannels":
      return router.push({ pathname: "/deleted-chats", params: { serverId } });
    case "support":
      return router.push("/settings/support");
    case "about":
      return router.push("/settings/about");
    case "serverOptions":
      return router.push({ pathname: "/server-settings", params: { serverId } });
    case "serverMembers":
      return router.push({ pathname: "/server-settings/members", params: { serverId } });
    case "serverRoutines":
      return router.push({ pathname: "/server-routines", params: { serverId } });
    case "serverUsage":
      return router.push({ pathname: "/server-usage", params: { serverId } });
  }
}

function fileIcon(file: Extract<MobileSearchResult, { kind: "file" }>["file"]): LucideIcon {
  if (file.attachment.kind === "image") return FileImage;
  return file.attachment.previewKind === "pdf" || file.attachment.previewKind === "text" ? FileText : FileIcon;
}

/**
 * One search result. A press closes the search and opens what the result names: the chat, the
 * channel, the message or the file in its chat, or the routine.
 */
export function MobileSearchResultRow({
  result,
  query,
  serverId,
  agents,
  onLeave,
}: {
  result: MobileSearchResult;
  query: string;
  serverId: string;
  /** The agents of the server, by ID, for the member avatars of a channel. */
  agents: ReadonlyMap<string, MobileAgent>;
  /** Runs before a result opens what it names, and closes the search. */
  onLeave: () => void;
}) {
  const { t, format } = useText();
  const gate = useContext(ChatNavigationGateContext);
  const pane = useChatListPane();
  // A chat opened through its home row zooms back into the row when it closes. A chat opened at a
  // message slides in. In the chat list pane, the chat takes the place of the open one.
  const openChat = (agentId: string, messageId?: string) => {
    onLeave();
    if (pane)
      openChatFromPane(pane, messageId ? undefined : agentId, () =>
        router.push({ pathname: "/chat/[agentId]", params: messageId ? { agentId, messageId } : { agentId } }),
      );
    else if (messageId) router.push({ pathname: "/chat/[agentId]", params: { agentId, messageId } });
    else if (!gate?.openFromHome(agentId)) router.push({ pathname: "/chat/[agentId]", params: { agentId } });
  };
  const snippet = useMemo(
    () => (result.kind === "message" ? mobileSearchSnippet(result.text, query) : ""),
    [result, query],
  );

  switch (result.kind) {
    case "agent": {
      const { agent } = result;
      return (
        <SearchRow
          leading={<AgentAvatar agent={agent} />}
          title={agent.name}
          detail={agent.title.trim() || agent.preview}
          trailing={agent.updatedLabel}
          query={query}
          onPress={() => openChat(agent.id)}
        />
      );
    }
    case "channel": {
      const { channel } = result;
      const last = channel.lastMessage;
      return (
        <SearchRow
          leading={<ChannelAvatar channel={channel} agents={agents} size={AVATAR_SIZE} />}
          title={channel.name}
          detail={last ? t("mobile.search.authorText", { author: last.authorName, text: last.text }) : channel.title}
          trailing={formatUpdatedAt(last?.at ?? null, format)}
          query={query}
          onPress={() => {
            onLeave();
            const open = () =>
              router.push({ pathname: "/channel/[channelId]", params: { channelId: channel.id, serverId } });
            if (pane) openChatFromPane(pane, channel.id, open);
            else if (!gate?.openFromHome(channel.id)) open();
          }}
        />
      );
    }
    case "message": {
      const { agent, message, from } = result;
      return (
        <SearchRow
          leading={<AgentAvatar agent={agent} />}
          title={agent.name}
          detail={
            from === "agent"
              ? snippet
              : from === "you"
                ? t("mobile.search.youWrote", { text: snippet })
                : t("mobile.search.authorText", { author: from.member, text: snippet })
          }
          detailLines={2}
          trailing={formatUpdatedAt(message.createdAt, format)}
          query={query}
          onPress={() => openChat(agent.id, message.id)}
        />
      );
    }
    case "file": {
      const { agent, file } = result;
      return (
        <SearchRow
          leading={<RowIcon icon={fileIcon(file)} />}
          title={file.attachment.name}
          detail={t("mobile.search.fileDetail", { name: agent.name, size: format.fileSize(file.attachment.size) })}
          trailing={formatUpdatedAt(file.createdAt, format)}
          query={query}
          // As on desktop, a file opens the message that carries it.
          onPress={() => openChat(agent.id, file.messageId)}
        />
      );
    }
    case "setting": {
      const { setting } = result;
      return (
        <SearchRow
          leading={<RowIcon icon={SETTING_ICON[setting.id]} />}
          title={setting.title}
          detail={setting.detail}
          query={query}
          onPress={() => {
            onLeave();
            openSetting(setting.id, serverId);
          }}
        />
      );
    }
    case "routine": {
      const { routine, owner } = result;
      return (
        <SearchRow
          leading={<RowIcon icon={CalendarClock} />}
          title={routine.name}
          detail={owner.name}
          trailing={routine.active ? undefined : t("mobile.search.routinePaused")}
          query={query}
          onPress={() => {
            onLeave();
            if (owner.kind === "agent")
              router.push({
                pathname: "/agent-info/[agentId]/routine",
                params: { agentId: owner.agent.id, serverId: owner.agent.serverId, recordId: routine.id },
              });
            else
              router.push({
                pathname: "/channel-info/[channelId]/routine",
                params: { channelId: owner.channel.id, serverId, recordId: routine.id },
              });
          }}
        />
      );
    }
  }
}
