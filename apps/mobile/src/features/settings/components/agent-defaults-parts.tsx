import type { AgentDefaultChoice, AgentDefaultSetting, AgentDefaultsOverview } from "@openbot/contracts/ipc";
import type { MobileTranslate } from "@openbot/i18n/mobile";
import { Typography } from "heroui-native";
import { View } from "react-native";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { agentDefaultOn, type useAgentDefaults } from "@/features/settings/model/agent-defaults";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";
import { useText } from "@/shared/lib/text";
import { SettingsNote } from "./settings-content";

const AVATAR_SIZE = 26;

/** The value of a setting: On or Off, and Steer or Queue for "Steer agents while they work". */
export function agentDefaultValueLabel(t: MobileTranslate, setting: AgentDefaultSetting, on: boolean): string {
  if (setting === "busyMessageMode") return t(on ? "mobile.agent.busyMessage.steer" : "mobile.agent.busyMessage.queue");
  return t(on ? "mobile.settings.agents.on" : "mobile.settings.agents.off");
}

/** The label of one choice of an agent. Default names the value that the agent then follows. */
export function agentDefaultChoiceLabel(
  t: MobileTranslate,
  overview: AgentDefaultsOverview,
  setting: AgentDefaultSetting,
  choice: AgentDefaultChoice,
): string {
  if (choice !== "default") return agentDefaultValueLabel(t, setting, choice === "on");
  return t("mobile.settings.agents.followDefault", {
    value: agentDefaultValueLabel(t, setting, agentDefaultOn(overview, setting)),
  });
}

/**
 * The state of the page when it has no overview to show: loading, a failed read, an offline server,
 * or a host without `agent-defaults-v1`. With an overview, it says only that the server is offline,
 * as the controls are then disabled.
 */
export function AgentDefaultsStatus({ state }: { state: ReturnType<typeof useAgentDefaults> }) {
  const { t, errorMessage } = useText();
  const { overview, online, rowState, query } = state;
  if (overview) return online ? null : <SettingsNote>{t("mobile.settings.agents.offline")}</SettingsNote>;
  const text =
    rowState === "hidden" || query.data === null
      ? t("mobile.agent.host.unsupported")
      : !online
        ? t("mobile.settings.agents.offline")
        : query.isError
          ? errorMessage(query.error, t("mobile.settings.agents.loadFailed"))
          : t("common.loading");
  return <SettingsNote>{text}</SettingsNote>;
}

/** The message of the last failed save. */
export function AgentDefaultsError({ error }: { error: string | null }) {
  return error ? (
    <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="px-4 text-danger-text">
      {error}
    </Typography.Paragraph>
  ) : null;
}

export function AgentDefaultsAvatar({ agent }: { agent: MobileAgent }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <BloubAvatar
        agentId={agent.id}
        serverId={agent.serverId}
        hue={agent.avatarHue}
        color={agent.avatarColor}
        seed={agent.avatarSeed}
        size={AVATAR_SIZE}
        animateIdle={false}
      />
    </View>
  );
}
