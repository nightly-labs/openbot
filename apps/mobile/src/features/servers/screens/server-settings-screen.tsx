import { DEFAULT_TEAM_MEMBER_LIMIT, INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { canAdministerServer } from "@openbot/contracts/ipc";
import { router, useLocalSearchParams } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import type { LucideIcon } from "lucide-react-native";
import Camera from "lucide-react-native/icons/camera";
import Database from "lucide-react-native/icons/database";
import Settings2 from "lucide-react-native/icons/settings-2";
import Sparkles from "lucide-react-native/icons/sparkles";
import UsersRound from "lucide-react-native/icons/users-round";
import Wrench from "lucide-react-native/icons/wrench";
import { useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { useCSSVariable } from "uniwind";
import { SERVER_AVATAR_CORNER_RATIO, ServerAvatar } from "@/features/servers/components/server-avatar";
import { TrailingValue } from "@/features/servers/components/trailing-value";
import {
  SERVER_SETTINGS_CATEGORIES,
  SERVER_SETTINGS_CATEGORY_TITLE_KEYS,
  type ServerSettingsCategory,
  useOwnerHostedServerIds,
  useServerSettingsItems,
} from "@/features/servers/model/server-settings-categories";
import { useLockedAction } from "@/features/servers/model/use-locked-action";
import { updateAvailable, useServerUpdate } from "@/features/servers/model/use-server-update";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { useLiveServerRecovery } from "@/features/workspace/context/server-recovery-countdown";
import type { MobileServer } from "@/features/workspace/model/workspace-types";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { type AvatarPhoto, pickAvatarPhoto } from "@/shared/lib/pick-avatar-photo";
import { useText } from "@/shared/lib/text";

const CATEGORY_ICONS = {
  general: Settings2,
  people: UsersRound,
  ai: Sparkles,
  data: Database,
  maintenance: Wrench,
} as const satisfies Record<ServerSettingsCategory, LucideIcon>;

const CATEGORY_PATHS = {
  general: "/server-settings/general",
  people: "/server-settings/people",
  ai: "/server-settings/ai",
  data: "/server-settings/data",
  maintenance: "/server-settings/maintenance",
} as const satisfies Record<ServerSettingsCategory, string>;

/**
 * The first page of Server settings: the server name and logo, a link to each page that has an item
 * for this role, and the action that ends this member's use of the server.
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
  const items = useServerSettingsItems(server, hostedServerIds);
  const { t } = useText();
  const { memberCountByServer } = useMobileWorkspace();
  const memberCount = memberCountByServer[server.id];
  const updateStatus = useServerUpdate(server.id, { poll: false }).query.data?.status;
  // The People row shows the member count, and Maintenance says when a new OpenBot version is ready.
  const values: Partial<Record<ServerSettingsCategory, string>> = {
    ...(memberCount === undefined
      ? {}
      : {
          people: t("mobile.server.settings.memberCount", {
            count: memberCount,
            limit: server.memberLimit ?? DEFAULT_TEAM_MEMBER_LIMIT,
          }),
        }),
    ...(updateStatus && updateAvailable(updateStatus)
      ? { maintenance: t("mobile.server.settings.updateAvailable") }
      : {}),
  };
  return (
    <SettingsContent>
      {canAdministerServer(server.role) ? <ServerIdentityForm server={server} /> : <ServerHeader server={server} />}
      <SettingsSection>
        {SERVER_SETTINGS_CATEGORIES.map((category) =>
          items[category].length > 0 ? (
            <ServerSettingsCategoryRow
              key={category}
              category={category}
              serverId={server.id}
              items={items[category]}
              value={values[category]}
            />
          ) : null,
        )}
      </SettingsSection>
      <ServerExitSection server={server} hostedServerIds={hostedServerIds} />
    </SettingsContent>
  );
}

/** A link to one page. The text under its title names the items on that page. */
function ServerSettingsCategoryRow({
  category,
  serverId,
  items,
  value,
}: {
  category: ServerSettingsCategory;
  serverId: string;
  items: ReturnType<typeof useServerSettingsItems>[ServerSettingsCategory];
  value: string | undefined;
}) {
  const { t, format } = useText();
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const Icon = CATEGORY_ICONS[category];
  return (
    <SettingsRow
      leading={<Icon size={20} color={muted} strokeWidth={1.75} />}
      supportingText={format.list(items.map((key) => t(key)))}
      // Without a value the row shows its own chevron.
      trailing={value === undefined ? undefined : <TrailingValue value={value} />}
      onPress={() => router.push({ pathname: CATEGORY_PATHS[category], params: { serverId } })}
    >
      <Typography.Paragraph>{t(SERVER_SETTINGS_CATEGORY_TITLE_KEYS[category])}</Typography.Paragraph>
    </SettingsRow>
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

/** The logo and name of the server, for a member, who cannot change them. */
function ServerHeader({ server }: { server: MobileServer }) {
  return (
    <View className="items-center gap-3">
      <ServerAvatar server={server} size={112} showStatus={false} />
      <Typography.Heading type="h4" align="center" numberOfLines={2} className="px-4">
        {server.name}
      </Typography.Heading>
    </View>
  );
}

/** The server name and logo. The host saves both and tells every connected client. */
function ServerIdentityForm({ server }: { server: MobileServer }) {
  const { t, errorMessage } = useText();
  const { canEditServerIdentity, updateServerIdentity } = useMobileWorkspace();
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
