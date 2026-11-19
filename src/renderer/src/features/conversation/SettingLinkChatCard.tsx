import type { SettingLinkId } from "@openbot/contracts/ipc";
import type { AgentMessage } from "@openbot/ui/data";
import {
  AGENT_SETTING_LINK_ROWS,
  AGENT_SETTINGS_PAGE_TITLE,
  type AgentSettingLinkId,
  isAgentSettingLinkId,
} from "@openbot/ui/features/conversation/agent-setting-links";
import { SettingLinkCard } from "@openbot/ui/features/conversation/SettingLinkCard";
import { useText } from "@openbot/ui/text";
import { usePlatform } from "../../platform";
import { appSettingLinkTarget } from "../settings/setting-link-targets";
import { navItem } from "../settings/settings-tabs";
import { useConversationViewScope } from "./conversation-scope";
import type { ConversationProps } from "./conversation-types";

export interface SettingLinkChatCardProps {
  settingId: SettingLinkId;
  agent: { id: string; name: string } | null;
  onOpenAgentSetting: (agentId: string, settingId: AgentSettingLinkId) => void;
  appSettingOpener?: ConversationProps["appSettingOpener"];
}

export function SettingLinkChatCard(props: SettingLinkChatCardProps) {
  const { t } = useText();
  const platform = usePlatform();
  const card = () => {
    const settingId = props.settingId;
    if (isAgentSettingLinkId(settingId)) {
      const row = AGENT_SETTING_LINK_ROWS[settingId];
      const agent = props.agent;
      const path = [agent?.name ?? "", t("agentSettings.title")].filter(Boolean);
      if (row.page) path.push(t(AGENT_SETTINGS_PAGE_TITLE[row.page]));
      return {
        title: t(row.title),
        path,
        open: agent ? () => props.onOpenAgentSetting(agent.id, settingId) : undefined,
        note: agent ? undefined : t("chat.settingLink.agentChatOnly"),
      };
    }
    const target = appSettingLinkTarget(settingId, platform.appInfo()?.platform);
    const open = props.appSettingOpener?.(settingId);
    return {
      title: t(target.row),
      path: [t("app.settingsPage.title"), t(navItem(target.tab).titleKey)],
      open,
      note: props.appSettingOpener ? undefined : t("chat.settingLink.desktopOnly"),
    };
  };
  return <SettingLinkCard title={card().title} path={card().path} onOpen={card().open} note={card().note} />;
}

export function useThreadSettingLinkCard() {
  const { props, channel, openAgentSettingRow } = useConversationViewScope();
  return (message: AgentMessage) => {
    const marker = message.actionMarker;
    if (marker?.kind !== "setting-link") return undefined;
    const agent = props.agent;
    return (
      <SettingLinkChatCard
        settingId={marker.settingId}
        agent={channel || !agent ? null : { id: agent.id, name: agent.name }}
        onOpenAgentSetting={openAgentSettingRow}
        appSettingOpener={props.appSettingOpener}
      />
    );
  };
}
