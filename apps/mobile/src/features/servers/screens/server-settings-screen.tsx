import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { canAdministerServer } from "@openbot/contracts/ipc";
import { router, useLocalSearchParams } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import LogOut from "lucide-react-native/icons/log-out";
import Trash2 from "lucide-react-native/icons/trash";
import { useRef, useState } from "react";
import { Alert, Keyboard, View } from "react-native";
import { SERVER_AVATAR_CORNER_RATIO, ServerAvatar } from "@/features/servers/components/server-avatar";
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
import { type AvatarPhoto, pickAvatarPhoto } from "@/shared/lib/pick-avatar-photo";
import { useText } from "@/shared/lib/text";

/**
 * Server settings, on one page: the server name, logo and status, then a section for each group of
 * settings that has an item for this role, and the action that ends this member's use of the server.
 * Each section shows only the rows that the host serves to this role.
 */
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
      {/* The owner rarely changes the key, so it comes last. */}
      <ServerKeySettings server={server} />
    </SettingsContent>
  );
}

/**
 * The connection status and the OpenBot version of the host, under the server name. The text of the
 * connection, such as an error, goes under them.
 */
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

/**
 * Leave for a member. For the owner: Delete for a server that the desktop app runs beside its own
 * server, or Remove from the account for a server that is not hosted.
 */
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
      // A server that the desktop app runs beside its own server: that app stops it and moves its data
      // to the Trash. Removed from the account only, it would come back at the next start of the app.
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
    // The owner removes the server from the account. The host does not need to be online.
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
                    // The account service explains a refusal, such as a hosted server that Billing deletes.
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

/** The logo, name and status of the server, for a member, who cannot change the name or logo. */
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

/**
 * The server logo, name and status. The owner or admin taps the logo to change it, and edits the name
 * in place; Save in the header saves both. The host saves them and tells every connected client.
 */
function ServerIdentityForm({ server }: { server: MobileServer }) {
  const { t, errorMessage } = useText();
  const { canEditServerIdentity, updateServerIdentity } = useMobileWorkspace();
  const available = canEditServerIdentity(server.id);
  const [draftName, setDraftName] = useState<string | undefined>();
  // Undefined keeps the saved logo; null removes it.
  const [logo, setLogo] = useState<AvatarPhoto | null | undefined>();
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const name = draftName ?? server.name;
  const trimmed = name.trim();
  const nameChanged = draftName !== undefined && trimmed !== server.name;
  const logoChanged = logo !== undefined && (logo !== null || server.logoKey !== null);
  const dirty = nameChanged || logoChanged;
  // A saved name from an older rule stays valid until the user changes it.
  const nameValid =
    !nameChanged || (trimmed.length >= INPUT_LIMITS.serverNameMin && trimmed.length <= INPUT_LIMITS.serverName);
  const hasLogo = logo === undefined ? server.logoKey !== null : logo !== null;

  // Discard turns prevention off before it repeats the action, so the hook does not warn.
  const [discarding, setDiscarding] = useState(false);
  usePreventRemove(!discarding && (dirty || saving || picking), ({ repeat }) => {
    if (pending.current || picking) return;
    void haptics.notification("warning");
    Alert.alert(t("mobile.agent.discard.title"), t("mobile.agent.discard.body"), [
      { text: t("mobile.agent.discard.keepEditing"), style: "cancel" },
      {
        text: t("mobile.agent.discard.discard"),
        style: "destructive",
        onPress: () => {
          setDiscarding(true);
          repeat();
        },
      },
    ]);
  });

  async function chooseLogo(): Promise<void> {
    if (pending.current || picking) return;
    setPicking(true);
    setError(null);
    try {
      const photo = await pickAvatarPhoto({ pathname: "/server-settings/crop-logo" }, SERVER_AVATAR_CORNER_RATIO);
      if (photo) setLogo(photo);
    } catch (cause) {
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.shared.photo.openFailed")));
    } finally {
      setPicking(false);
    }
  }

  function editLogo(): void {
    // The name field locks while the photo picker is open, so it gives up the keyboard first.
    Keyboard.dismiss();
    void haptics.impact("soft");
    if (!hasLogo) {
      void chooseLogo();
      return;
    }
    Alert.alert(t("mobile.server.settings.logo"), undefined, [
      { text: t("mobile.server.settings.changeLogo"), onPress: () => void chooseLogo() },
      {
        text: t("mobile.server.settings.removeLogo"),
        style: "destructive",
        onPress: () => {
          setError(null);
          setLogo(null);
        },
      },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  }

  async function save(): Promise<void> {
    if (!dirty || !nameValid || !available || picking || pending.current) return;
    pending.current = true;
    setSaving(true);
    setError(null);
    Keyboard.dismiss();
    try {
      await updateServerIdentity(server.id, {
        ...(nameChanged ? { serverName: trimmed } : {}),
        ...(logoChanged ? { logo: logo ? { mimeType: logo.mimeType, bytes: logo.bytes } : null } : {}),
      });
      setDraftName(undefined);
      setLogo(undefined);
      void haptics.notification("success");
    } catch (cause) {
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.server.settings.identitySaveFailed")));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  const locked = !available || saving || picking;
  return (
    <View className="gap-3">
      <SettingsIdentityHeader
        picture={
          <ServerAvatar
            server={{ ...server, name: trimmed || server.name }}
            size={IDENTITY_PICTURE_SIZE}
            showStatus={false}
            logoUri={logo === undefined ? undefined : (logo?.uri ?? null)}
          />
        }
        pictureLabel={t(hasLogo ? "mobile.server.settings.editLogo" : "mobile.server.settings.addLogo")}
        onPicturePress={available ? editLogo : undefined}
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
      <SheetSaveAction
        dirty={dirty}
        canSave={nameValid && available}
        pending={saving || picking}
        onSave={() => void save()}
      />
    </View>
  );
}
