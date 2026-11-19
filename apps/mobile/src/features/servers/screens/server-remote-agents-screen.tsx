import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useEffect, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { SettingsContent, SettingsNote, SettingsSection } from "@/features/settings/components/settings-content";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { useText } from "@/shared/lib/text";

interface InviteRow {
  inviteId: string;
  code: string;
  expiresAt: string;
}
interface LinkRow {
  linkId: string;
  peerName: string;
}

export function ServerRemoteAgentsScreen() {
  const { t, errorMessage } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const actions = useMobileWorkspaceActions();
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [code, setCode] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reachReady, setReachReady] = useState<boolean | null>(null);

  async function reload(): Promise<void> {
    if (!serverId) return;
    const snapshot = await actions.loadRemoteAgentBridge(serverId);
    setInvites(snapshot.invites);
    setLinks(snapshot.links);
  }

  useEffect(() => {
    if (!serverId) return;
    void (async () => {
      try {
        const snapshot = await actions.loadRemoteAgentBridge(serverId);
        setInvites(snapshot.invites);
        setLinks(snapshot.links);
        const status = await actions.remoteAgentBridgeReachStatus(serverId);
        setReachReady(status.ready);
      } catch (cause: unknown) {
        setError(errorMessage(cause, t("mobile.server.update.actionFailed")));
      }
    })();
  }, [serverId, actions, errorMessage, t]);

  async function run(action: () => Promise<void>): Promise<void> {
    setError(null);
    try {
      await action();
      await reload();
    } catch (cause) {
      setError(errorMessage(cause, t("mobile.server.update.actionFailed")));
    }
  }

  return (
    <SettingsContent>
      <SettingsSection title={t("mobile.server.settings.remoteAgents")}>
        <SettingsNote>{t("mobile.server.settings.remoteAgentsDescription")}</SettingsNote>
        {error ? <SettingsNote>{error}</SettingsNote> : null}
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            void run(async () => {
              if (!serverId) return;
              const status = await actions.prepareRemoteAgentBridgeReach(serverId);
              setReachReady(status.ready);
            })
          }
        >
          <Typography.Paragraph>{t("mobile.server.settings.remoteAgentsPrepareCrossNetwork")}</Typography.Paragraph>
        </Pressable>
        {reachReady === false ? (
          <SettingsNote>{t("mobile.server.settings.remoteAgentsPrepareCrossNetworkHint")}</SettingsNote>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            void run(async () => {
              if (!serverId) return;
              setCreated((await actions.createRemoteAgentBridgeInvite(serverId)).code);
            })
          }
        >
          <Typography.Paragraph>{t("mobile.server.settings.remoteAgentsCreate")}</Typography.Paragraph>
        </Pressable>
        {created ? (
          <SettingsNote>
            {t("mobile.server.settings.remoteAgentsCode")}: {created}
          </SettingsNote>
        ) : null}
        <TextInput
          value={code}
          onChangeText={setCode}
          placeholder={t("mobile.server.settings.remoteAgentsPaste")}
          onSubmitEditing={() =>
            void run(async () => {
              if (!serverId || !code.trim()) return;
              await actions.redeemRemoteAgentBridge(code.trim(), serverId);
              setCode("");
            })
          }
        />
        {invites.length === 0 && links.length === 0 ? (
          <SettingsNote>{t("mobile.server.settings.remoteAgentsEmpty")}</SettingsNote>
        ) : null}
        {invites.map((invite) => (
          <View key={invite.inviteId}>
            <Typography.Paragraph>
              {t("mobile.server.settings.remoteAgentsExpires", { date: invite.expiresAt })}
            </Typography.Paragraph>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                void run(async () => {
                  if (!serverId) return;
                  await actions.revokeRemoteAgentBridgeInvite(invite.inviteId, serverId);
                })
              }
            >
              <Typography.Paragraph>{t("mobile.server.settings.remoteAgentsRevoke")}</Typography.Paragraph>
            </Pressable>
          </View>
        ))}
        {links.map((link) => (
          <View key={link.linkId}>
            <Typography.Paragraph>{link.peerName}</Typography.Paragraph>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                void run(async () => {
                  if (!serverId) return;
                  await actions.revokeRemoteAgentBridgeLink(link.linkId, serverId);
                })
              }
            >
              <Typography.Paragraph>{t("mobile.server.settings.remoteAgentsRevoke")}</Typography.Paragraph>
            </Pressable>
          </View>
        ))}
      </SettingsSection>
    </SettingsContent>
  );
}
