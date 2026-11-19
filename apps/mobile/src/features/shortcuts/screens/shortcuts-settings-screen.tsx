import { Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import { useEffect, useState } from "react";
import { useCSSVariable } from "uniwind";
import { BloubAvatarThumbnail } from "@/features/agents/components/bloub-avatar";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { loadShortcutAgent, saveShortcutAgent, useShortcutAgent } from "../model/shortcut-agent";
import type { ShortcutTarget } from "../model/shortcut-target";
import { shortcutsSupported } from "../shortcuts-native";

/**
 * Settings > Shortcuts: the agent that gets the messages of the iOS shortcut Send Message. The
 * choice is for this phone and this account.
 */
export function ShortcutsSettingsScreen() {
  const { t } = useText();
  const { session } = useMobileSession();
  const servers = useMobileWorkspaceSelector((current) => current.servers);
  const agents = useMobileWorkspaceSelector((current) => current.agents);
  const target = useShortcutAgent((state) => state.target);
  const ready = useShortcutAgent((state) => state.account !== null);
  const saving = useShortcutAgent((state) => state.saving);
  const accent = String(useCSSVariable("--openbot-accent"));
  const [error, setError] = useState<string | null>(null);
  const apiUrl = session?.apiUrl;
  const userId = session?.user.id;

  useEffect(() => {
    if (apiUrl && userId) void loadShortcutAgent(apiUrl, userId);
  }, [apiUrl, userId]);

  if (!shortcutsSupported) {
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.settings.shortcuts.unsupported")}</SettingsNote>
      </SettingsContent>
    );
  }

  const choose = (next: ShortcutTarget | null) => {
    if (!apiUrl || !userId) return;
    if (next?.serverId === target?.serverId && next?.agentId === target?.agentId) return;
    setError(null);
    void haptics.selection();
    void saveShortcutAgent(apiUrl, userId, next).catch(() => {
      setError(t("mobile.settings.saveFailed"));
      void haptics.notification("error");
    });
  };
  const mark = <Check size={18} color={accent} strokeWidth={2} />;
  const groups = servers
    .map((server) => ({ server, agents: agents.filter((agent) => agent.serverId === server.id) }))
    .filter((group) => group.agents.length > 0);
  const footer = error ?? t("mobile.settings.shortcuts.footer");

  return (
    <SettingsContent>
      <SettingsSection title={t("mobile.settings.shortcuts.agent")} footer={groups.length === 0 ? footer : undefined}>
        <SettingsRow
          checked={target === null}
          disclosure={false}
          disabled={!ready || saving}
          trailing={target === null ? mark : null}
          onPress={() => choose(null)}
        >
          <Typography.Paragraph>{t("mobile.settings.shortcuts.none")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      {groups.map((group, index) => (
        <SettingsSection
          key={group.server.id}
          title={group.server.name}
          footer={index === groups.length - 1 ? footer : undefined}
        >
          {group.agents.map((agent) => {
            const chosen = target?.serverId === agent.serverId && target.agentId === agent.id;
            return (
              <SettingsRow
                key={agent.id}
                checked={chosen}
                disclosure={false}
                disabled={!ready || saving}
                leading={
                  <BloubAvatarThumbnail
                    agentId={agent.id}
                    serverId={agent.serverId}
                    hue={agent.avatarHue}
                    color={agent.avatarColor}
                    seed={agent.avatarSeed}
                    size={32}
                  />
                }
                trailing={chosen ? mark : null}
                onPress={() => choose({ serverId: agent.serverId, agentId: agent.id })}
              >
                <Typography.Paragraph>{agent.name}</Typography.Paragraph>
              </SettingsRow>
            );
          })}
        </SettingsSection>
      ))}
    </SettingsContent>
  );
}
