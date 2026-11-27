import type { SettingLinkId } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import type { AgentMessage } from "@openbot/ui/data";
import {
  AGENT_SETTING_LINK_ROWS,
  AGENT_SETTINGS_PAGE_TITLE,
  type AgentSettingLinkId,
  isAgentSettingLinkId,
} from "@openbot/ui/features/conversation/agent-setting-links";
import { SettingLinkCard } from "@openbot/ui/features/conversation/SettingLinkCard";
import { CreditIcon } from "@openbot/ui/features/credits/CreditIcon";
import { CreditsExplainerDialog } from "@openbot/ui/features/credits/CreditsExplainerDialog";
import { useText } from "@openbot/ui/text";
import { createSignal, Show } from "solid-js";
import { usePlatform } from "../../platform";
import { useCreditModels } from "../credits/credits-context";
import { openCreditPrices } from "../servers/credit-prices";
import { serverRoleCanAdminister } from "../servers/server-capabilities";
import { appSettingLinkTarget } from "../settings/setting-link-targets";
import { navItem } from "../settings/settings-tabs";
import { conversationRuntime } from "./conversation-runtime";
import { useConversationViewScope } from "./conversation-scope";
import type { ConversationProps } from "./conversation-types";

const ADMIN_ONLY_REMOTE_AGENT_SETTINGS: ReadonlySet<AgentSettingLinkId> = new Set([
  "agent.access",
  "agent.computer-use",
  "agent.local-scripts",
  "agent.folders",
  "agent.busy-message",
  "agent.browser-profile",
  "agent.starts-new-chats",
  "agent.plan-card",
  "agent.builtin-memory",
  "agent.backup-models",
]);

export interface SettingLinkChatCardProps {
  settingId: SettingLinkId;
  agent: { id: string; name: string } | null;
  onOpenAgentSetting: (agentId: string, settingId: AgentSettingLinkId) => void;
  appSettingOpener?: ConversationProps["appSettingOpener"];
}

function CreditsExplainerChatCard() {
  const { t } = useText();
  const { props } = useConversationViewScope();
  const [open, setOpen] = createSignal(false);
  const creditModels = useCreditModels();
  return (
    <>
      <SettingLinkCard
        title={t("billing.credits.explainer.title")}
        path={[t("billing.credits.explainer.place"), t("app.rail.credits")]}
        icon={<CreditIcon />}
        onOpen={() => setOpen(true)}
      />
      <CreditsExplainerDialog
        open={open()}
        onOpenChange={setOpen}
        models={creditModels()}
        onOpenPrices={() => openCreditPrices(conversationRuntime(props).openUrl)}
      />
    </>
  );
}

export function SettingLinkChatCard(props: SettingLinkChatCardProps) {
  return (
    <Show when={props.settingId !== "credits.explainer"} fallback={<CreditsExplainerChatCard />}>
      <SettingRowChatCard {...props} />
    </Show>
  );
}

function SettingRowChatCard(props: SettingLinkChatCardProps) {
  const { t } = useText();
  const platform = usePlatform();
  const view = useConversationViewScope();
  const card = () => {
    const settingId = props.settingId;
    if (isAgentSettingLinkId(settingId)) {
      const row = AGENT_SETTING_LINK_ROWS[settingId];
      const agent = props.agent;
      const path = [agent?.name ?? "", t("agentSettings.title")].filter(Boolean);
      if (row.page) path.push(t(AGENT_SETTINGS_PAGE_TITLE[row.page]));
      const server = view.props.server;
      const adminOnly =
        server?.kind === "remote" &&
        !serverRoleCanAdminister(server) &&
        ADMIN_ONLY_REMOTE_AGENT_SETTINGS.has(settingId);
      return {
        title: t(row.title),
        path,
        open: !agent
          ? undefined
          : adminOnly
            ? () => toast.info(t("chat.settingLink.adminOnly"))
            : () => props.onOpenAgentSetting(agent.id, settingId),
        note: agent ? undefined : t("chat.settingLink.agentChatOnly"),
      };
    }
    if (settingId === "credits.explainer") return { title: "", path: [], open: undefined, note: undefined };
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
