import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { canAdministerServer } from "@openbot/contracts/ipc";
import { router, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import LogOut from "lucide-react-native/icons/log-out";
import Palette from "lucide-react-native/icons/palette";
import Trash2 from "lucide-react-native/icons/trash";
import { useRef, useState } from "react";
import { Alert, Keyboard, View } from "react-native";
import { ServerAvatar } from "@/features/servers/components/server-avatar";
import { ServerStatusLabel } from "@/features/servers/components/server-status-label";
import { useOwnerHostedServerIds } from "@/features/servers/model/server-settings-access";
import { useLockedAction } from "@/features/servers/model/use-locked-action";
import { useServerUpdate } from "@/features/servers/model/use-server-update";
import {
  ServerAiSection,
  ServerConnectionSection,
  ServerDataSections,
  ServerGeneralSection,
  ServerKeySettings,
  ServerPeopleSection,
} from "@/features/servers/screens/server-settings-sections";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { IDENTITY_PICTURE_SIZE, SettingsIdentityHeader } from "@/features/settings/components/settings-identity-header";
import { RowIcon } from "@/features/settings/components/settings-row-icon";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { useLiveServerRecovery } from "@/features/workspace/context/server-recovery-countdown";
import type { MobileServer } from "@/features/workspace/model/workspace-types";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { useDiscardGuard } from "@/shared/lib/use-discard-guard";

export function ServerSettingsScreen() {
  const { t } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { servers } = useMobileWorkspace();
  const server = useLiveServerRecovery(servers.find((item) => item.id === serverId));
  if (!server)
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.server.unavailable")}</SettingsNote>
      </SettingsContent>
    );
  return <ServerSettingsHome server={server} />;
}

function ServerSettingsHome({ server }: { server: MobileServer }) {
  const hostedServerIds = useOwnerHostedServerIds(server);
  return (
    <SettingsContent>
      {canAdministerServer(server.role) ? <ServerIdentityForm server={server} /> : <ServerHeader server={server} />}
      <ServerGeneralSection serverId={server.id} />
      <ServerPeopleSection server={server} />
      <ServerAiSection serverId={server.id} />
      <ServerDataSections serverId={server.id} />
      <ServerConnectionSection server={server} hostedServerIds={hostedServerIds} />
      <ServerExitSection server={server} hostedServerIds={hostedServerIds} />
      <ServerKeySettings server={server} />
    </SettingsContent>
  );
}

function ServerStatusLine({ server }: { server: MobileServer }) {
  const { t, sourceText } = useText();
  const version = useServerUpdate(server.id, { poll: false }).query.data?.status.currentVersion;
  return (
    <View className="gap-1">
      <View className="flex-row flex-wrap items-center">
        <ServerStatusLabel server={server} />
        {version ? (
          <Typography.Paragraph className="text-grouped-secondary">
            {` · ${t("mobile.server.update.version", { version })}`}
          </Typography.Paragraph>
        ) : null}
      </View>
      {server.connectionMessage ? (
        <Typography.Paragraph type="body-xs" className="text-grouped-secondary">
          {sourceText(server.connectionMessage)}
        </Typography.Paragraph>
      ) : null}
    </View>
  );
}

function ServerExitSection({
  server,
  hostedServerIds,
}: {
  server: MobileServer;
  hostedServerIds: ReadonlySet<string> | null;
}) {
  const { t, errorMessage } = useText();
  const { leaveServer, removeServer, deleteLocalServer, localServerKind } = useMobileWorkspace();
  const serverId = server.id;
  const { busy, error, perform } = useLockedAction();
  if (server.role !== "owner")
    return (
      <SettingsSection footer={error}>
        <SettingsRow
          leading={<RowIcon icon={LogOut} tone="danger" />}
          disclosure={false}
          disabled={busy}
          onPress={() =>
            Alert.alert(
              t("mobile.server.settings.leaveTitle", { name: server.name }),
              t("mobile.server.settings.leaveBody"),
              [
                { text: t("common.cancel"), style: "cancel" },
                {
                  text: t("mobile.server.settings.leave"),
                  style: "destructive",
                  onPress: () =>
                    void perform(async () => {
                      await leaveServer(serverId);
                      router.dismiss();
                    }),
                },
              ],
            )
          }
        >
          <Typography.Paragraph className="text-danger-text">{t("mobile.server.settings.leave")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    );
  const kind = localServerKind(serverId);
  if (kind === "computer") return null;
  if (kind === "onComputer")
    return (
      <SettingsSection footer={error}>
        <SettingsRow
          leading={<RowIcon icon={Trash2} tone="danger" />}
          disclosure={false}
          disabled={busy}
          onPress={() =>
            Alert.alert(
              t("mobile.server.settings.deleteTitle", { name: server.name }),
              t("mobile.server.settings.deleteBody"),
              [
                { text: t("common.cancel"), style: "cancel" },
                {
                  text: t("mobile.server.settings.delete"),
                  style: "destructive",
                  onPress: () =>
                    void perform(
                      async () => {
                        await deleteLocalServer(serverId);
                        router.dismiss();
                      },
                      (caught) => errorMessage(caught, t("mobile.server.settings.updateFailed")),
                    ),
                },
              ],
            )
          }
        >
          <Typography.Paragraph className="text-danger-text">{t("mobile.server.settings.delete")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    );
  if (!hostedServerIds || hostedServerIds.has(serverId)) return null;
  return (
    <SettingsSection footer={error}>
      <SettingsRow
        leading={<RowIcon icon={Trash2} tone="danger" />}
        disclosure={false}
        disabled={busy}
        onPress={() =>
          Alert.alert(
            t("mobile.server.settings.removeTitle", { name: server.name }),
            t("mobile.server.settings.removeBody"),
            [
              { text: t("common.cancel"), style: "cancel" },
              {
                text: t("mobile.server.settings.remove"),
                style: "destructive",
                onPress: () =>
                  void perform(
                    async () => {
                      await removeServer(serverId);
                      router.dismiss();
                    },
                    (caught) => errorMessage(caught, t("mobile.server.settings.updateFailed")),
                  ),
              },
            ],
          )
        }
      >
        <Typography.Paragraph className="text-danger-text">{t("mobile.server.settings.remove")}</Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}

function ServerHeader({ server }: { server: MobileServer }) {
  const { t } = useText();
  return (
    <SettingsIdentityHeader
      picture={<ServerAvatar server={server} size={IDENTITY_PICTURE_SIZE} showStatus={false} />}
      name={server.name}
      nameLabel={t("mobile.server.settings.name")}
      subtitle={<ServerStatusLine server={server} />}
    />
  );
}

function ServerIdentityForm({ server }: { server: MobileServer }) {
  const { t, errorMessage } = useText();
  const { canEditServerIdentity, updateServerIdentity } = useMobileWorkspace();
  const available = canEditServerIdentity(server.id);
  const [draftName, setDraftName] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const name = draftName ?? server.name;
  const trimmed = name.trim();
  const nameChanged = draftName !== undefined && trimmed !== server.name;
  const dirty = nameChanged;
  const nameValid =
    !nameChanged || (trimmed.length >= INPUT_LIMITS.serverNameMin && trimmed.length <= INPUT_LIMITS.serverName);

  useDiscardGuard(dirty || saving, { busy: () => pending.current, warn: true });

  function editPicture(): void {
    Keyboard.dismiss();
    void haptics.impact("soft");
    router.push({ pathname: "/server-settings/logo", params: { serverId: server.id } });
  }

  async function save(): Promise<void> {
    if (!dirty || !nameValid || !available || pending.current) return;
    pending.current = true;
    setSaving(true);
    setError(null);
    Keyboard.dismiss();
    try {
      await updateServerIdentity(server.id, { serverName: trimmed });
      setDraftName(undefined);
      void haptics.notification("success");
    } catch (cause) {
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.server.settings.identitySaveFailed")));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  const locked = !available || saving;
  return (
    <View className="gap-3">
      <SettingsIdentityHeader
        picture={
          <ServerAvatar
            server={{ ...server, name: trimmed || server.name }}
            size={IDENTITY_PICTURE_SIZE}
            showStatus={false}
          />
        }
        pictureLabel={t("mobile.server.settings.editLogo")}
        pictureIcon={Palette}
        onPicturePress={available ? editPicture : undefined}
        name={name}
        nameLabel={t("mobile.server.settings.name")}
        nameMaxLength={INPUT_LIMITS.serverName}
        disabled={locked}
        onNameChange={
          available
            ? (value) => {
                setDraftName(value);
                setError(null);
              }
            : undefined
        }
        onNameSubmit={() => void save()}
        subtitle={<ServerStatusLine server={server} />}
      />
      {!nameValid ? (
        <Typography.Paragraph type="body-xs" accessibilityRole="alert" className="px-1 text-danger-text">
          {t("mobile.server.settings.nameLength", { min: INPUT_LIMITS.serverNameMin, max: INPUT_LIMITS.serverName })}
        </Typography.Paragraph>
      ) : null}
      {!available ? (
        <SettingsNote>
          {t(
            server.state === "online"
              ? "mobile.server.settings.identityUnsupported"
              : "mobile.server.settings.identityOffline",
          )}
        </SettingsNote>
      ) : null}
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" className="px-1 text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
      <SheetSaveAction dirty={dirty} canSave={nameValid && available} pending={saving} onSave={() => void save()} />
    </View>
  );
}
