import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { Camera } from "lucide-react-native";
import { useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { ServerAvatar } from "@/features/servers/components/server-avatar";
import { ServerStatusLabel } from "@/features/servers/components/server-status-label";
import { SERVER_ROLE_KEYS } from "@/features/servers/model/server-role";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import type { MobileServer } from "@/features/workspace/model/workspace-types";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { type AvatarPhoto, pickAvatarPhoto } from "@/shared/lib/pick-avatar-photo";
import { useText } from "@/shared/lib/text";

export function ServerSettingsScreen() {
  const { t, sourceText, errorMessage } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { servers, leaveServer, removeServer, refreshServer } = useMobileWorkspace();
  const server = servers.find((item) => item.id === serverId);
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function perform(operation: () => Promise<void>, failure?: (error: unknown) => string) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await operation();
      void haptics.notification("success");
    } catch (caught) {
      setError(failure?.(caught) ?? t("mobile.server.settings.updateFailed"));
      void haptics.notification("error");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  if (!server)
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.server.unavailable")}</SettingsNote>
      </SettingsContent>
    );
  return (
    <SettingsContent>
      {server.role !== "member" ? <ServerIdentityForm server={server} /> : null}
      <SettingsSection title={server.name}>
        <SettingsRow
          disclosure={false}
          supportingText={t("mobile.server.settings.role", { role: t(SERVER_ROLE_KEYS[server.role]) })}
        >
          <ServerStatusLabel server={server} />
        </SettingsRow>
        {server.connectionMessage ? <SettingsNote>{sourceText(server.connectionMessage)}</SettingsNote> : null}
        <SettingsRow onPress={() => router.push({ pathname: "/server-settings/members", params: { serverId } })}>
          <Typography.Paragraph type="body-sm">{t("mobile.server.settings.members")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow disclosure={false} disabled={busy} onPress={() => void perform(() => refreshServer(serverId))}>
          <Typography.Paragraph type="body-sm">
            {busy ? t("mobile.server.settings.refreshing") : t("mobile.server.settings.refresh")}
          </Typography.Paragraph>
        </SettingsRow>
        {server.role !== "owner" ? (
          <SettingsRow
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
            <Typography.Paragraph type="body-sm" className="text-danger-text">
              {t("mobile.server.settings.leave")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : (
          // The owner removes the server from the account. The host does not need to be online.
          <SettingsRow
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
            <Typography.Paragraph type="body-sm" className="text-danger-text">
              {t("mobile.server.settings.remove")}
            </Typography.Paragraph>
          </SettingsRow>
        )}
        {error ? <SettingsNote>{error}</SettingsNote> : null}
      </SettingsSection>
    </SettingsContent>
  );
}

/** The server name and logo. The host saves both and tells every connected client. */
function ServerIdentityForm({ server }: { server: MobileServer }) {
  const { t, errorMessage } = useText();
  const { canEditServerIdentity, updateServerIdentity } = useMobileWorkspace();
  const navigation = useNavigation();
  const foreground = useThemeColor("foreground");
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

  usePreventRemove(dirty || saving || picking, ({ data }) => {
    if (pending.current || picking) return;
    void haptics.notification("warning");
    Alert.alert(t("mobile.agent.discard.title"), t("mobile.agent.discard.body"), [
      { text: t("mobile.agent.discard.keepEditing"), style: "cancel" },
      {
        text: t("mobile.agent.discard.discard"),
        style: "destructive",
        onPress: () => navigation.dispatch(data.action),
      },
    ]);
  });

  async function chooseLogo(): Promise<void> {
    if (pending.current || picking) return;
    setPicking(true);
    setError(null);
    try {
      const photo = await pickAvatarPhoto({ pathname: "/server-settings/crop-logo" });
      if (photo) setLogo(photo);
    } catch (cause) {
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.shared.photo.openFailed")));
    } finally {
      setPicking(false);
    }
  }

  function editLogo(): void {
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
    <View className="gap-5">
      <Pressable
        className="self-center"
        accessibilityRole="button"
        accessibilityLabel={t(hasLogo ? "mobile.server.settings.editLogo" : "mobile.server.settings.addLogo")}
        accessibilityState={{ disabled: locked }}
        disabled={locked}
        onPress={editLogo}
      >
        <ServerAvatar
          server={{ ...server, name: trimmed || server.name }}
          size={112}
          showStatus={false}
          logoUri={logo === undefined ? undefined : (logo?.uri ?? null)}
        />
        <View className="absolute -right-2 -bottom-2 size-9 items-center justify-center rounded-full border-4 border-sheet bg-grouped">
          <Camera color={foreground} size={14} />
        </View>
      </Pressable>
      <SheetFormField
        label={t("mobile.server.settings.name")}
        autoCapitalize="words"
        maxLength={INPUT_LIMITS.serverName}
        value={name}
        editable={!locked}
        hint={
          !nameValid
            ? t("mobile.server.settings.nameLength", { min: INPUT_LIMITS.serverNameMin, max: INPUT_LIMITS.serverName })
            : undefined
        }
        onChangeText={(value) => {
          setDraftName(value);
          setError(null);
        }}
      />
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
        <Typography.Paragraph accessibilityRole="alert" className="px-4 text-danger-text">
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
