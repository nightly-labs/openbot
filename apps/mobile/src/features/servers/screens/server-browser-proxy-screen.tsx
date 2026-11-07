import {
  BROWSER_PROXY_ADDRESS_MAX,
  BROWSER_PROXY_LIMIT,
  browserProxyAddressText,
  browserProxyName,
  browserProxySaveAddress,
  editableBrowserProxyAddress,
  parseBrowserProxyAddress,
  type SaveBrowserProxyInput,
} from "@openbot/contracts/ipc";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import Monitor from "lucide-react-native/icons/monitor";
import Plus from "lucide-react-native/icons/plus";
import Waypoints from "lucide-react-native/icons/waypoints";
import { useRef, useState } from "react";
import { Alert, View } from "react-native";
import { useCSSVariable } from "uniwind";
import { type BrowserProfileStack, openBrowserProxyPage } from "@/features/servers/model/browser-profile-pages";
import { useServerBrowserProfiles } from "@/features/servers/model/use-server-browser-profiles";
import {
  type BrowserProxyChoice,
  useBrowserProxyChoices,
  useBrowserProxyState,
  useServerBrowserProxies,
} from "@/features/servers/model/use-server-browser-proxies";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

function stackOf(agentId: string | undefined): BrowserProfileStack {
  return agentId ? { kind: "agent", agentId } : { kind: "server" };
}

/** The icon of a proxy row: a waypoint for a saved proxy, a monitor for a member's computer. */
function ProxyIcon({ kind }: { kind: BrowserProxyChoice["kind"] }) {
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const Icon = kind === "computer" ? Monitor : Waypoints;
  return (
    <View className="size-8 items-center justify-center">
      <Icon size={18} color={muted} strokeWidth={1.75} />
    </View>
  );
}

/**
 * The Proxies section of Browser profiles (`browser-proxies-v1`): each saved proxy, each computer of
 * a member, and Add proxy. A row opens its page. A proxy that failed or a computer that is offline
 * shows that in red.
 */
export function BrowserProxiesSection({ serverId, stack }: { serverId: string; stack: BrowserProfileStack }) {
  const { t, errorMessage } = useText();
  const accent = String(useCSSVariable("--openbot-accent"));
  const proxies = useServerBrowserProxies(serverId);
  const choices = useBrowserProxyChoices(proxies.list);
  const state = useBrowserProxyState();
  if (!proxies.available) return null;
  const list = proxies.list;
  if (!list)
    return (
      <SettingsSection title={t("mobile.server.browserProxies.title")}>
        <SettingsRow
          disclosure={false}
          disabled={proxies.query.isFetching}
          onPress={proxies.query.isError ? () => void proxies.query.refetch() : undefined}
          supportingText={
            proxies.query.isError
              ? errorMessage(proxies.query.error, t("mobile.server.browserProxies.loadFailed"))
              : undefined
          }
        >
          <Typography.Paragraph className={proxies.query.isError ? "text-accent" : "text-grouped-secondary"}>
            {proxies.query.isError ? t("mobile.server.members.retry") : t("mobile.server.browserProxies.loading")}
          </Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    );
  const full = list.proxies.length >= BROWSER_PROXY_LIMIT;
  return (
    <SettingsSection
      title={t("mobile.server.browserProxies.title")}
      footer={
        full
          ? t("mobile.server.browserProxies.limit", { limit: BROWSER_PROXY_LIMIT })
          : t("mobile.server.browserProxies.sectionHint")
      }
    >
      {choices.map((choice) => {
        const problem = choice.offline || choice.failure !== null;
        return (
          <SettingsRow
            key={choice.id}
            leading={<ProxyIcon kind={choice.kind} />}
            onPress={() => openBrowserProxyPage(stack, serverId, { proxyId: choice.id })}
          >
            <Typography.Paragraph numberOfLines={1}>{choice.name}</Typography.Paragraph>
            <Typography.Paragraph type="body-xs" className={problem ? "text-danger-text" : "text-grouped-secondary"}>
              {state(
                choice,
                list.proxies.find((proxy) => proxy.id === choice.id),
              )}
            </Typography.Paragraph>
          </SettingsRow>
        );
      })}
      {full ? null : (
        <SettingsRow
          disclosure={false}
          leading={
            <View className="size-8 items-center justify-center">
              <Plus size={18} color={accent} strokeWidth={2} />
            </View>
          }
          onPress={() => openBrowserProxyPage(stack, serverId)}
        >
          <Typography.Paragraph className="text-accent">{t("mobile.server.browserProxies.add")}</Typography.Paragraph>
        </SettingsRow>
      )}
    </SettingsSection>
  );
}

/**
 * Browser profiles > one saved proxy, a new proxy without `proxyId`, or the computer of a member.
 * A proxy has one address field; a saved password shows as a mask, and a save that keeps the mask
 * keeps the password. A save asks first when it closes open tabs, and a save that does not change
 * the address saves nothing. From a profile's proxy choice (`assignTo`), a new proxy goes to that
 * profile. A computer has no address: its member shares it from the desktop app, and this page only
 * shows its state and deletes it. Delete changes its profiles to Automatic.
 */
export function ServerBrowserProxyScreen() {
  const { t, errorMessage } = useText();
  const { serverId, proxyId, assignTo } = useLocalSearchParams<{
    serverId: string;
    proxyId?: string;
    assignTo?: string;
  }>();
  const proxies = useServerBrowserProxies(serverId);
  const { profiles } = useServerBrowserProfiles(serverId);
  const choices = useBrowserProxyChoices(proxies.list);
  const state = useBrowserProxyState();
  const list = proxies.list;
  const proxy = proxyId ? list?.proxies.find((candidate) => candidate.id === proxyId) : undefined;
  const choice = proxyId ? choices.find((candidate) => candidate.id === proxyId) : undefined;
  // The address that the page opened with: the host refuses a save when the proxy is different now.
  const opened = useRef<{ address: string; previousAddress: string } | null>(null);
  if (proxy && opened.current === null)
    opened.current = { address: editableBrowserProxyAddress(proxy), previousAddress: browserProxyAddressText(proxy) };
  const initial = opened.current?.address ?? "";
  const [draft, setDraft] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  /** True after a save or a delete: the page leaves without the question about the address. */
  const leaving = useRef(false);
  const address = draft ?? initial;
  const trimmed = address.trim();
  const dirty = draft !== undefined && trimmed !== initial;

  const [discarding, setDiscarding] = useState(false);
  usePreventRemove(!discarding && dirty, ({ repeat }) => {
    if (leaving.current) {
      setDiscarding(true);
      repeat();
      return;
    }
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

  /** Runs one change at a time, then goes back. */
  async function perform(operation: () => Promise<void>): Promise<void> {
    if (locked.current) return;
    locked.current = true;
    leaving.current = true;
    setPending(true);
    setError(null);
    try {
      await operation();
      void haptics.notification("success");
      router.back();
    } catch (cause) {
      leaving.current = false;
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.server.browserProxies.saveFailed")));
    } finally {
      locked.current = false;
      setPending(false);
    }
  }

  // After a delete the new list has no proxy: the closing page shows nothing, not the gone note.
  if (proxyId && !choice && leaving.current) return <SettingsContent />;
  if (!proxies.available || !list || (proxyId && !choice))
    return (
      <SettingsContent>
        <SettingsNote>
          {!proxies.available
            ? t("mobile.server.browserProfiles.unavailable")
            : proxies.query.isError
              ? errorMessage(proxies.query.error, t("mobile.server.browserProxies.loadFailed"))
              : !list
                ? t("mobile.server.browserProxies.loading")
                : t("mobile.server.browserProxies.gone")}
        </SettingsNote>
      </SettingsContent>
    );

  /** The open tabs of these named profiles: a proxy change closes them. */
  const openTabs = (profileIds: readonly string[]) =>
    (profiles ?? []).reduce(
      (count, profile) => (profileIds.includes(profile.id) ? count + profile.tabCount : count),
      0,
    );
  const editedProfiles = proxy ? proxy.profileIds : assignTo ? [assignTo] : [];

  function save(): void {
    if (!trimmed) return;
    const parsed = parseBrowserProxyAddress(trimmed);
    if (parsed === null) {
      void haptics.notification("error");
      setError(t("mobile.server.browserProxies.addressInvalid"));
      return;
    }
    const next = browserProxySaveAddress(proxy, parsed, trimmed);
    const input: SaveBrowserProxyInput = { address: next.address };
    if (proxy && opened.current) {
      input.proxyId = proxy.id;
      input.previousAddress = opened.current.previousAddress;
    }
    if (next.keepPassword) input.keepPassword = true;
    const run = () =>
      void perform(async () => {
        const saved = await proxies.save(input);
        if (proxy || !assignTo) return;
        // The proxy exists now, also when the profile does not take it: the page then shows it.
        setDraft(undefined);
        router.setParams({ proxyId: saved.id, assignTo: undefined });
        await proxies.setProfileProxy(assignTo, saved.id);
      });
    const closes = openTabs(editedProfiles);
    if (closes === 0) {
      run();
      return;
    }
    void haptics.notification("warning");
    Alert.alert(
      proxy
        ? t("mobile.server.browserProxies.editTitle", { name: browserProxyName(proxy, list?.proxies ?? []) })
        : t("mobile.server.browserProxies.add"),
      t("mobile.server.browserProxies.closesTabs", { count: closes }),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("common.save"), onPress: run },
      ],
    );
  }

  function remove(current: BrowserProxyChoice): void {
    // The profiles that use it now, as the question shows them. The host refuses the delete when they change.
    const profileIds = [...current.profileIds];
    const used = profileIds.length
      ? t("mobile.server.browserProxies.deleteUsed", { count: profileIds.length })
      : t("mobile.server.browserProxies.deleteUnused");
    const closes = openTabs(profileIds);
    void haptics.notification("warning");
    Alert.alert(
      t("mobile.server.browserProfiles.deleteTitle", { name: current.name }),
      closes ? `${used}\n\n${t("mobile.server.browserProxies.closesTabs", { count: closes })}` : used,
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("mobile.server.browserProxies.delete"),
          style: "destructive",
          onPress: () => void perform(() => proxies.remove(current.id, profileIds)),
        },
      ],
    );
  }

  const usedBy = (profiles ?? []).filter((profile) => choice?.profileIds.includes(profile.id));
  const problem = choice && (choice.offline || choice.failure !== null);
  return (
    <SettingsContent>
      <Stack.Screen options={{ title: choice?.name ?? t("mobile.server.browserProxies.add") }} />
      {choice?.kind === "computer" ? (
        <SettingsNote>{t("mobile.server.browserProxies.computerHint")}</SettingsNote>
      ) : (
        <>
          <SettingsNote>{t("mobile.server.browserProxies.addressHint")}</SettingsNote>
          <SheetFormField
            label={t("mobile.server.browserProxies.address")}
            placeholder={t("mobile.server.browserProxies.addressPlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
            inputMode="url"
            autoFocus={!proxy}
            maxLength={BROWSER_PROXY_ADDRESS_MAX}
            error={error ?? undefined}
            value={address}
            editable={!pending}
            returnKeyType="done"
            onSubmitEditing={() => {
              if (dirty && trimmed) save();
            }}
            onChangeText={(value) => {
              setDraft(value);
              setError(null);
            }}
          />
          <SheetSaveAction
            dirty={dirty}
            canSave={trimmed.length > 0}
            pending={pending}
            label={proxy ? undefined : t("mobile.server.browserProfiles.addConfirm")}
            onSave={save}
          />
        </>
      )}
      {error && choice?.kind === "computer" ? (
        <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="px-4 text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
      {choice ? (
        <>
          <SettingsSection title={t("mobile.server.browserProxies.profilesTitle")}>
            <SettingsRow disclosure={false}>
              <Typography.Paragraph className={problem ? "text-danger-text" : undefined}>
                {state(choice, proxy)}
              </Typography.Paragraph>
            </SettingsRow>
            {usedBy.map((profile) => (
              <SettingsRow key={profile.id} disclosure={false}>
                <Typography.Paragraph numberOfLines={1}>{profile.name}</Typography.Paragraph>
              </SettingsRow>
            ))}
          </SettingsSection>
          <SettingsSection footer={t("mobile.server.browserProxies.deleteHint")}>
            <SettingsRow disclosure={false} disabled={pending} onPress={() => remove(choice)}>
              <Typography.Paragraph className="text-danger-text">
                {t("mobile.server.browserProxies.delete")}
              </Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
        </>
      ) : null}
    </SettingsContent>
  );
}

/**
 * Browser profiles > one profile > Proxy: Automatic, each saved proxy and each computer of a member.
 * A choice saves at once; when the profile has open tabs, the page asks first, because the host
 * closes them. New proxy adds a proxy and gives it to the profile. The phone cannot offer itself:
 * a member shares a computer from the desktop app.
 */
export function BrowserProfileProxyScreen() {
  const { t, errorMessage } = useText();
  const accent = String(useCSSVariable("--openbot-accent"));
  const { serverId, profileId, agentId } = useLocalSearchParams<{
    serverId: string;
    profileId: string;
    agentId?: string;
  }>();
  const stack = stackOf(agentId);
  const proxies = useServerBrowserProxies(serverId);
  const { profiles, query: profilesQuery } = useServerBrowserProfiles(serverId);
  const choices = useBrowserProxyChoices(proxies.list);
  const state = useBrowserProxyState();
  const [pending, setPending] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const profile = profiles?.find((candidate) => candidate.id === profileId);
  const list = proxies.list;
  if (!proxies.available || !list || !profile)
    return (
      <SettingsContent>
        <SettingsNote>
          {!proxies.available
            ? t("mobile.server.browserProfiles.unavailable")
            : proxies.query.isError || profilesQuery.isError
              ? errorMessage(proxies.query.error ?? profilesQuery.error, t("mobile.server.browserProxies.loadFailed"))
              : !list || !profiles
                ? t("mobile.server.browserProxies.loading")
                : t("mobile.server.browserProfiles.gone")}
        </SettingsNote>
      </SettingsContent>
    );
  const current = choices.find((choice) => choice.profileIds.includes(profile.id))?.id ?? null;

  function apply(proxyId: string | null): void {
    void haptics.selection();
    setPending(proxyId);
    setError(null);
    proxies
      .setProfileProxy(profileId, proxyId)
      .then(() => {
        void haptics.notification("success");
      })
      .catch((cause: unknown) => {
        void haptics.notification("error");
        setError(errorMessage(cause, t("mobile.server.browserProxies.saveFailed")));
      })
      .finally(() => setPending(undefined));
  }

  function choose(proxyId: string | null): void {
    if (pending !== undefined || !profile || proxyId === current) return;
    if (profile.tabCount === 0) {
      apply(proxyId);
      return;
    }
    void haptics.notification("warning");
    Alert.alert(
      t("mobile.server.browserProxies.changeTitle", { name: profile.name }),
      t("mobile.server.browserProxies.closesTabs", { count: profile.tabCount }),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("mobile.server.browserProxies.change"), onPress: () => apply(proxyId) },
      ],
    );
  }

  const options: { id: string | null; name: string; choice?: BrowserProxyChoice }[] = [
    { id: null, name: t("mobile.server.browserProxies.automatic") },
    ...choices.map((choice) => ({ id: choice.id, name: choice.name, choice })),
  ];
  const full = list.proxies.length >= BROWSER_PROXY_LIMIT;
  const hasOwnComputer = list.computers.some((computer) => computer.mine);
  return (
    <SettingsContent>
      <Stack.Screen options={{ title: t("mobile.server.browserProxies.menu") }} />
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="px-4 text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
      <SettingsSection
        footer={
          hasOwnComputer
            ? t("mobile.server.browserProxies.choiceHint")
            : `${t("mobile.server.browserProxies.choiceHint")} ${t("mobile.server.browserProxies.shareHint")}`
        }
      >
        {options.map((option) => {
          const selected = option.id === current;
          const problem = option.choice && (option.choice.offline || option.choice.failure !== null);
          return (
            <SettingsRow
              key={option.id ?? "automatic"}
              checked={selected}
              disabled={pending !== undefined}
              disclosure={false}
              leading={option.choice ? <ProxyIcon kind={option.choice.kind} /> : undefined}
              trailing={selected ? <Check size={18} color={accent} strokeWidth={2} /> : null}
              onPress={() => choose(option.id)}
            >
              <Typography.Paragraph numberOfLines={1}>{option.name}</Typography.Paragraph>
              {problem && option.choice ? (
                <Typography.Paragraph type="body-xs" className="text-danger-text">
                  {state(option.choice)}
                </Typography.Paragraph>
              ) : null}
            </SettingsRow>
          );
        })}
        {full ? null : (
          <SettingsRow
            disclosure={false}
            disabled={pending !== undefined}
            leading={
              <View className="size-8 items-center justify-center">
                <Plus size={18} color={accent} strokeWidth={2} />
              </View>
            }
            onPress={() => openBrowserProxyPage(stack, serverId, { assignTo: profile.id })}
          >
            <Typography.Paragraph className="text-accent">{t("mobile.server.browserProxies.new")}</Typography.Paragraph>
          </SettingsRow>
        )}
      </SettingsSection>
    </SettingsContent>
  );
}
