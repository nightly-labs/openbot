import {
  type AgentProviderId,
  type AgentProviderStatus,
  claudeCompactWindowSizes,
  isAgentProvider,
  isInstallerProvider,
  isKeyOnlyProvider,
  PROMPT_CACHE_TTLS,
  type PromptCacheTtl,
  type ProviderAccountStatus,
  type ProviderApiKeyStatus,
} from "@openbot/contracts/ipc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Chip, Typography } from "heroui-native";
import type { LucideIcon } from "lucide-react-native";
import CircleArrowUp from "lucide-react-native/icons/circle-arrow-up";
import Clock from "lucide-react-native/icons/clock";
import Download from "lucide-react-native/icons/download";
import Globe from "lucide-react-native/icons/globe";
import KeyRound from "lucide-react-native/icons/key-round";
import Layers from "lucide-react-native/icons/layers";
import LogIn from "lucide-react-native/icons/log-in";
import LogOut from "lucide-react-native/icons/log-out";
import Minimize2 from "lucide-react-native/icons/minimize-2";
import Package from "lucide-react-native/icons/package";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import RotateCcw from "lucide-react-native/icons/rotate-ccw";
import Star from "lucide-react-native/icons/star";
import UserPlus from "lucide-react-native/icons/user-plus";
import UserRound from "lucide-react-native/icons/user-round";
import X from "lucide-react-native/icons/x";
import { useRef, useState } from "react";
import { Alert, View } from "react-native";
import { useUniwind } from "uniwind";
import { useProviderAccountName } from "@/features/agents/components/agent-runtime-fields";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { ProviderMark } from "@/features/servers/components/provider-mark";
import { TrailingValue } from "@/features/servers/components/trailing-value";
import {
  type ProviderAdmin,
  type ProviderRow,
  providerAccountStateKey,
  providerRuntimeBusy,
  providerSignOutOffered,
} from "@/features/servers/model/provider-admin";
import { useOpenSignIn } from "@/features/servers/model/use-open-sign-in";
import { useProviderModels } from "@/features/servers/model/use-provider-models";
import {
  useHostProviderDefault,
  useProviderKeyState,
  useServerProviderAccounts,
  useServerProviders,
} from "@/features/servers/model/use-server-providers";
import { providerStatusLabel } from "@/features/servers/screens/server-providers-screen";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { SettingsPicker, SettingsSwitch } from "@/features/settings/components/settings-controls";
import { IDENTITY_PICTURE_SIZE, SettingsIdentityHeader } from "@/features/settings/components/settings-identity-header";
import { RowIcon } from "@/features/settings/components/settings-row-icon";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { haptics } from "@/shared/lib/haptics";
import { currentText, type MobileText, useText } from "@/shared/lib/text";

type RuntimeAction = "cancel" | "update" | "retry" | "download" | "check";

const RUNTIME_ACTION_ICONS = {
  cancel: X,
  update: CircleArrowUp,
  retry: RotateCcw,
  download: Download,
  check: RefreshCw,
} as const satisfies Record<RuntimeAction, LucideIcon>;

/** The Version line names the CLI that runs: the one the user installed, or OpenBot's download. */
const VERSION_SOURCE_KEYS = {
  system: "mobile.server.providers.versionInstalledByUser",
  managed: "mobile.server.providers.versionDownloaded",
} as const satisfies Record<NonNullable<AgentProviderStatus["cliSource"]>, string>;

/** The colour of the status in the page header, in the order of the desktop header: a problem first. */
function providerStatusColor(row: ProviderRow): "success" | "warning" | "danger" | "accent" | "default" {
  const state = row.status?.state;
  if (row.status?.off) return "default";
  if (providerRuntimeBusy(row) || (row.status?.connectionState === "connecting" && state !== "available"))
    return "accent";
  if (row.runtime?.phase === "download-error" || state === "error") return "danger";
  if (row.updatable || state === "outdated") return "warning";
  return state === "available" ? "success" : "default";
}

/** What the API key does for the provider, as the API key card of the desktop page says it. */
function keyDescription(row: ProviderRow, key: ProviderApiKeyStatus | undefined, { t }: Pick<MobileText, "t">) {
  const saved = key === "saved";
  if (row.id === "opencode") return t("mobile.server.providers.keyOptional");
  if (row.id === "antigravity" && saved) return t("mobile.server.providers.geminiKeyInUse");
  if (row.id === "claude" && saved) return t("mobile.server.providers.claudeKeyInUse");
  if (row.id === "codex")
    return t(saved ? "mobile.server.providers.codexKeyInUse" : "mobile.server.providers.codexKeyAlternative");
  if (isKeyOnlyProvider(row.id)) return t("mobile.server.providers.keyHint");
  return undefined;
}

/**
 * Server settings > Providers > one provider of the host: its status, its sign-in, its API key, the
 * download or update of its CLI, and how the host's agents use it. The host checks the role on every
 * request. A code or key goes to the host only, and the phone does not keep it.
 */
export function ServerProviderScreen() {
  const text = useText();
  const { t, sourceText, errorMessage } = text;
  const { theme } = useUniwind();
  const params = useLocalSearchParams<{ serverId: string; provider: string }>();
  const serverId = params.serverId;
  const provider = isAgentProvider(params.provider) ? params.provider : null;
  const providers = useServerProviders(serverId);
  const { available, admin, status, rows, applyRuntimes, refreshStatus } = providers;
  const accounts = useServerProviderAccounts(serverId, admin);
  const row = rows.find((candidate) => candidate.id === provider);
  // A provider that is off has no Models row, so the page does not read its list.
  const models = useProviderModels(serverId, row?.status?.off ? null : provider, admin);
  const keyState = useProviderKeyState(serverId, row?.apiKey ? admin : null, provider);
  const defaultProvider = useHostProviderDefault(serverId, admin?.defaultProvider ?? null);
  const { agents } = useMobileWorkspace();
  const locked = useRef(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The last check found no update, so the page says the provider is up to date. */
  const [checked, setChecked] = useState(false);
  const openSignInPage = useOpenSignIn();

  async function run(key: string, operation: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setPending(key);
    setError(null);
    try {
      await operation();
      void haptics.notification("success");
    } catch (cause) {
      setError(errorMessage(cause, t("mobile.server.providers.actionFailed")));
      void haptics.notification("error");
    } finally {
      locked.current = false;
      setPending(null);
    }
  }

  if (!available || !admin || !provider || !row)
    return (
      <SettingsContent>
        <SettingsNote>
          {!available || !provider
            ? t("mobile.server.providers.unavailable")
            : status.isError
              ? errorMessage(status.error, t("mobile.server.providers.loadFailed"))
              : t("mobile.server.providers.loading")}
        </SettingsNote>
      </SettingsContent>
    );

  const state = row.status?.state;
  /** The sign-in runs on its own page, which closes when the sign-in ends. */
  function openSignIn(method: "code" | "relay", extra: { add?: "1" } = {}) {
    if (provider) openSignInPage({ serverId, provider, method, ...extra });
  }

  const busy = pending !== null;
  const runtime = row.runtime;
  // A download can be cancelled; the setup step after it cannot. An update downloads the newer version.
  // An installed runtime with no update offers a check, as the row menu of the desktop tab does. An
  // installer provider has no update.
  const runtimeAction: RuntimeAction | null =
    runtime?.phase === "downloading"
      ? "cancel"
      : !runtime || providerRuntimeBusy(row)
        ? null
        : row.updatable
          ? "update"
          : runtime.phase === "download-error"
            ? "retry"
            : runtime.phase === "not-downloaded"
              ? "download"
              : isInstallerProvider(runtime.provider)
                ? null
                : "check";
  // A provider whose CLI is not on the host yet downloads before it signs in.
  // As on desktop, a connected provider offers Reconnect: the same sign-in, for another account or
  // a sign-in that the provider no longer accepts.
  const connectable = !runtime || runtime.phase === "ready";
  const connect = row.signIn;
  const alternative = connectable ? row.alternativeSignIn : null;
  const version = runtime?.version ?? row.status?.version ?? null;
  const cliSource = row.status?.cliSource;
  // The host lists only a provider that can hold more than one account.
  const providerAccounts = accounts.list.data?.providers.find((entry) => entry.provider === provider)?.accounts;
  const hasAccounts = Boolean(providerAccounts && providerAccounts.length > 0);
  const message = row.status?.message ?? row.status?.checkError ?? null;
  const signOut = admin.signOut;
  // As on desktop, a saved key keeps the provider connected, and with an accounts list the provider's
  // own account offers Disconnect on its page.
  const keySaved = row.apiKey && keyState.data === "saved";
  const disconnectable = signOut !== null && providerSignOutOffered(row) && !keySaved && !hasAccounts;
  const off = row.status?.off === true;
  const modelList = models.list.data;
  // As on desktop, a provider that lists no model has no Models row.
  const modelsShown = !off && models.available && ((modelList?.models.length ?? 0) > 0 || models.list.isError);
  const users = agents.filter((agent) => agent.serverId === serverId && agent.provider === provider);
  const isDefault = defaultProvider.current.data?.provider === provider;
  const connectOnComputer =
    connectable && !connect && state !== "available" && !(row.apiKey && isKeyOnlyProvider(provider));
  const signInShown =
    !hasAccounts && (Boolean(row.status?.email) || (connectable && Boolean(connect)) || disconnectable);

  const providerName = row.name;
  const signedInAs = row.status?.email ?? row.name;
  function disconnect() {
    if (!signOut || !provider) return;
    const target = provider;
    const blocked =
      users.length > 0
        ? currentText().t("mobile.server.providers.disconnectBlocked", {
            agents: currentText().format.list(users.map((agent) => agent.name)),
          })
        : null;
    Alert.alert(
      currentText().t("mobile.server.providers.disconnectTitle", { name: signedInAs }),
      [currentText().t("mobile.server.providers.disconnectBody", { provider: providerName }), blocked]
        .filter(Boolean)
        .join(" "),
      [
        { text: currentText().t("common.cancel"), style: "cancel" },
        {
          text: currentText().t("mobile.server.providers.disconnect"),
          style: "destructive",
          onPress: () =>
            void run("sign-out", async () => {
              await signOut(target);
              await Promise.all([refreshStatus(), accounts.refresh()]);
            }),
        },
      ],
    );
  }

  return (
    <SettingsContent>
      <Stack.Screen options={{ title: row.name }} />
      <SettingsIdentityHeader
        picture={
          <View
            className="items-center justify-center rounded-grouped bg-grouped"
            style={{ width: IDENTITY_PICTURE_SIZE, height: IDENTITY_PICTURE_SIZE }}
          >
            <ProviderMark provider={provider} size={IDENTITY_PICTURE_SIZE / 2} />
          </View>
        }
        name={row.name}
        nameLabel={row.name}
        subtitle={
          <View className="items-start gap-1.5">
            <Chip size="sm" variant="soft" color={providerStatusColor(row)} accessibilityRole="text">
              <Chip.Label>{providerStatusLabel(row, text)}</Chip.Label>
            </Chip>
            <Typography.Paragraph type="body-xs" className="text-grouped-secondary">
              {users.length > 0
                ? t("mobile.server.providers.usedByCount", { count: users.length })
                : t("mobile.server.providers.unused")}
            </Typography.Paragraph>
          </View>
        }
      />
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="px-4 text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
      {message && !signInShown ? <SettingsNote>{sourceText(message)}</SettingsNote> : null}
      {signInShown ? (
        <SettingsSection
          title={t("mobile.server.providers.sectionSignIn")}
          footer={
            message
              ? sourceText(message)
              : connectable && connect
                ? t(connect === "relay" ? "mobile.server.providers.relayHint" : "mobile.server.providers.connectHint")
                : connectOnComputer
                  ? t("mobile.server.providers.connectOnComputer")
                  : undefined
          }
        >
          {row.status?.email ? (
            <SettingsRow
              disclosure={false}
              leading={<RowIcon icon={UserRound} />}
              supportingText={t("mobile.server.providers.account")}
            >
              <Typography.Paragraph numberOfLines={1}>{row.status.email}</Typography.Paragraph>
            </SettingsRow>
          ) : null}
          {connectable && connect ? (
            <SettingsRow
              disclosure={false}
              disabled={busy}
              leading={<RowIcon icon={state === "available" ? RefreshCw : LogIn} tone="accent" />}
              onPress={() => openSignIn(connect)}
            >
              <Typography.Paragraph className="text-accent">
                {t(state === "available" ? "mobile.server.providers.reconnect" : "mobile.server.providers.connect")}
              </Typography.Paragraph>
            </SettingsRow>
          ) : null}
          {alternative ? (
            <SettingsRow
              disclosure={false}
              disabled={busy}
              leading={<RowIcon icon={Globe} tone="accent" />}
              onPress={() => openSignIn(alternative)}
            >
              <Typography.Paragraph className="text-accent">
                {t("mobile.server.providers.signInBrowser")}
              </Typography.Paragraph>
            </SettingsRow>
          ) : null}
          {disconnectable ? (
            <SettingsRow
              disclosure={false}
              disabled={busy}
              leading={<RowIcon icon={LogOut} tone="danger" />}
              onPress={disconnect}
            >
              <Typography.Paragraph className="text-danger-text">
                {t("mobile.server.providers.disconnect")}
              </Typography.Paragraph>
            </SettingsRow>
          ) : null}
        </SettingsSection>
      ) : null}
      {!hasAccounts && connectOnComputer && !signInShown ? (
        <SettingsNote>{t("mobile.server.providers.connectOnComputer")}</SettingsNote>
      ) : null}
      {hasAccounts && providerAccounts ? (
        <ProviderAccountsSection
          serverId={serverId}
          provider={provider}
          accounts={providerAccounts}
          canAdd={connectable && admin.accounts?.canSignIn(provider) === true}
          busy={busy}
          onAdd={() => openSignIn("relay", { add: "1" })}
        />
      ) : null}
      {!off && (modelsShown || admin.defaultProvider) ? (
        <SettingsSection
          title={t("mobile.server.providers.sectionUse")}
          footer={
            defaultProvider.error ??
            (defaultProvider.current.isError
              ? errorMessage(defaultProvider.current.error, t("mobile.server.providers.loadFailed"))
              : models.list.isError
                ? errorMessage(models.list.error, t("mobile.server.providers.modelsLoadFailed"))
                : !admin.defaultProvider
                  ? undefined
                  : isDefault
                    ? t("mobile.server.providers.startsWith", { name: row.name })
                    : state !== "available"
                      ? t("mobile.server.providers.connectFirst", { name: row.name })
                      : undefined)
          }
        >
          {modelsShown ? (
            <SettingsRow
              disabled={!modelList}
              leading={<RowIcon icon={Layers} />}
              trailing={
                modelList ? (
                  <TrailingValue
                    value={t("mobile.server.providers.modelsCount", {
                      shown: modelList.shown.length,
                      total: modelList.models.length,
                    })}
                  />
                ) : undefined
              }
              onPress={() =>
                router.push({ pathname: "/server-settings/provider-models", params: { serverId, provider } })
              }
            >
              <Typography.Paragraph>{t("mobile.server.providers.models")}</Typography.Paragraph>
            </SettingsRow>
          ) : null}
          {admin.defaultProvider ? (
            <SettingsRow leading={<RowIcon icon={Star} />}>
              <SettingsSwitch
                value={isDefault}
                // The host has no "none": another provider becomes the default on its own page.
                disabled={
                  isDefault || !defaultProvider.current.isSuccess || defaultProvider.saving || state !== "available"
                }
                label={t("mobile.server.providers.defaultForNew")}
                dark={theme === "dark"}
                onValueChange={(on) => {
                  if (on) defaultProvider.choose(provider);
                }}
              />
            </SettingsRow>
          ) : null}
        </SettingsSection>
      ) : null}
      {provider === "claude" && !off && admin.promptCache ? (
        <PromptCacheSection serverId={serverId} setting={admin.promptCache} />
      ) : null}
      {provider === "claude" && !off && admin.compactWindow ? (
        <CompactWindowSection serverId={serverId} setting={admin.compactWindow} />
      ) : null}
      {row.apiKey ? (
        <SettingsSection
          title={t("mobile.server.providers.apiKey")}
          footer={
            keyState.isError
              ? errorMessage(keyState.error, t("mobile.server.providers.keyLoadFailed"))
              : keyDescription(row, keyState.data, text)
          }
        >
          <SettingsRow
            leading={<RowIcon icon={KeyRound} />}
            trailing={
              keyState.data ? (
                <TrailingValue
                  value={t(
                    keyState.data === "saved" || keyState.data === "unreadable"
                      ? "mobile.server.providers.keySaved"
                      : "mobile.server.providers.keyMissing",
                  )}
                />
              ) : undefined
            }
            onPress={() => router.push({ pathname: "/server-settings/provider-key", params: { serverId, provider } })}
          >
            <View className="flex-row items-center gap-2">
              <Typography.Paragraph>{t("mobile.server.providers.apiKey")}</Typography.Paragraph>
              {row.id === "opencode" && keyState.data === "missing" ? (
                <Chip size="sm" variant="soft" color="success" className="self-center" accessibilityRole="text">
                  <Chip.Label>{t("mobile.server.providers.keyFree")}</Chip.Label>
                </Chip>
              ) : null}
            </View>
          </SettingsRow>
        </SettingsSection>
      ) : null}
      {version || (runtime && runtimeAction) ? (
        <SettingsSection
          title={t("mobile.server.providers.sectionRuntime")}
          footer={
            runtime?.phase === "download-error" && runtime.message
              ? sourceText(runtime.message)
              : checked && !row.updatable
                ? t("mobile.server.providers.upToDate", { name: row.name })
                : undefined
          }
        >
          {version ? (
            <SettingsRow
              disclosure={false}
              leading={<RowIcon icon={Package} />}
              trailing={
                <Typography.Paragraph numberOfLines={1} className="shrink text-grouped-secondary">
                  {cliSource ? t(VERSION_SOURCE_KEYS[cliSource], { version }) : version}
                </Typography.Paragraph>
              }
            >
              <Typography.Paragraph>{t("mobile.server.providers.version")}</Typography.Paragraph>
            </SettingsRow>
          ) : null}
          {runtime && runtimeAction ? (
            <SettingsRow
              disclosure={false}
              disabled={busy}
              leading={
                <RowIcon
                  icon={RUNTIME_ACTION_ICONS[runtimeAction]}
                  tone={runtimeAction === "cancel" ? "danger" : "accent"}
                />
              }
              onPress={() =>
                void run("runtime", async () => {
                  await applyRuntimes(
                    await (runtimeAction === "cancel"
                      ? admin.cancelDownload(runtime.provider)
                      : runtimeAction === "check"
                        ? admin.checkUpdates()
                        : admin.download(runtime.provider)),
                  );
                  setChecked(runtimeAction === "check");
                })
              }
            >
              <Typography.Paragraph className={runtimeAction === "cancel" ? "text-danger-text" : "text-accent"}>
                {runtimeAction === "update" && runtime.availableVersion
                  ? t("mobile.server.providers.updateTo", { version: runtime.availableVersion })
                  : t(
                      runtimeAction === "cancel"
                        ? "mobile.server.providers.cancelDownload"
                        : runtimeAction === "check"
                          ? pending === "runtime"
                            ? "mobile.server.providers.checking"
                            : "mobile.server.providers.checkUpdates"
                          : runtimeAction === "update"
                            ? "mobile.server.providers.update"
                            : runtimeAction === "retry"
                              ? "mobile.server.providers.retry"
                              : "mobile.server.providers.download",
                    )}
              </Typography.Paragraph>
            </SettingsRow>
          ) : null}
        </SettingsSection>
      ) : null}
    </SettingsContent>
  );
}

const PROMPT_CACHE_TTL_KEYS = {
  "5m": "mobile.server.providers.promptCacheDefault",
  "1h": "mobile.server.providers.promptCacheHour",
} as const;

/**
 * How long Claude keeps the prompt cache of the host's agents (`prompt-cache-ttl-v1`), as the Cache
 * section of the desktop Claude page. A change applies to the next Claude process on the host.
 */
function PromptCacheSection({
  serverId,
  setting,
}: {
  serverId: string;
  setting: NonNullable<ProviderAdmin["promptCache"]>;
}) {
  const { t, errorMessage } = useText();
  const { theme } = useUniwind();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.providerPromptCache(queryScope, serverId);
  const current = useQuery({ queryKey, retry: false, staleTime: 0, queryFn: () => setting.read() });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = t("mobile.server.providers.promptCache");
  return (
    <SettingsSection
      footer={
        error ??
        (current.isError
          ? errorMessage(current.error, t("mobile.server.providers.promptCacheLoadFailed"))
          : t("mobile.server.providers.promptCacheHint"))
      }
    >
      <SettingsRow
        disclosure={false}
        leading={<RowIcon icon={Clock} />}
        trailing={
          current.data ? (
            <SettingsPicker<PromptCacheTtl>
              value={current.data.ttl}
              options={PROMPT_CACHE_TTLS.map((ttl) => ({ value: ttl, label: t(PROMPT_CACHE_TTL_KEYS[ttl]) }))}
              enabled={!saving}
              dark={theme === "dark"}
              label={label}
              onChange={(ttl) => {
                if (ttl === current.data?.ttl) return;
                setSaving(true);
                setError(null);
                setting
                  .set(ttl)
                  .then(async (saved) => {
                    await queryClient.cancelQueries({ queryKey, exact: true });
                    queryClient.setQueryData(queryKey, saved);
                    void haptics.notification("success");
                  })
                  .catch((cause: unknown) => {
                    setError(errorMessage(cause, t("mobile.server.providers.actionFailed")));
                    void haptics.notification("error");
                  })
                  .finally(() => setSaving(false));
              }}
            />
          ) : null
        }
      >
        <Typography.Paragraph>{label}</Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}

/** A picker value: `default` for Claude Code's own size, or a number of tokens as text. */
type CompactWindowChoice = "default" | `${number}`;

function compactWindowChoice(tokens: number | null): CompactWindowChoice {
  return tokens === null ? "default" : `${tokens}`;
}

/**
 * The size at which Claude Code compacts the chats of the host's agents (`claude-compact-window-v1`),
 * as the Context section of the desktop Claude page. A change applies to the next Claude process on
 * the host. A size that another client saved and that is not a choice here still shows.
 */
function CompactWindowSection({
  serverId,
  setting,
}: {
  serverId: string;
  setting: NonNullable<ProviderAdmin["compactWindow"]>;
}) {
  const { t, format, errorMessage } = useText();
  const { theme } = useUniwind();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.providerCompactWindow(queryScope, serverId);
  const current = useQuery({ queryKey, retry: false, staleTime: 0, queryFn: () => setting.read() });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = t("mobile.server.providers.compactWindow");
  const options = claudeCompactWindowSizes(current.data?.tokens ?? null).map((size) => ({
    value: compactWindowChoice(size),
    label:
      size === null
        ? t("mobile.server.providers.compactWindowDefault")
        : t("mobile.server.providers.compactWindowTokens", { size: format.compact(size) }),
  }));
  return (
    <SettingsSection
      footer={
        error ??
        (current.isError
          ? errorMessage(current.error, t("mobile.server.providers.compactWindowLoadFailed"))
          : t("mobile.server.providers.compactWindowHint"))
      }
    >
      <SettingsRow
        disclosure={false}
        leading={<RowIcon icon={Minimize2} />}
        trailing={
          current.data ? (
            <SettingsPicker<CompactWindowChoice>
              value={compactWindowChoice(current.data.tokens)}
              options={options}
              enabled={!saving}
              dark={theme === "dark"}
              label={label}
              onChange={(choice) => {
                if (choice === compactWindowChoice(current.data?.tokens ?? null)) return;
                setSaving(true);
                setError(null);
                setting
                  .set(choice === "default" ? null : Number(choice))
                  .then(async (next) => {
                    await queryClient.cancelQueries({ queryKey, exact: true });
                    queryClient.setQueryData(queryKey, next);
                    void haptics.notification("success");
                  })
                  .catch((cause: unknown) => {
                    setError(errorMessage(cause, t("mobile.server.providers.actionFailed")));
                    void haptics.notification("error");
                  })
                  .finally(() => setSaving(false));
              }}
            />
          ) : null
        }
      >
        <Typography.Paragraph>{label}</Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}

/** The accounts of the provider on the host. Each agent uses one; its settings choose which. */
function ProviderAccountsSection({
  serverId,
  provider,
  accounts,
  canAdd,
  busy,
  onAdd,
}: {
  serverId: string;
  provider: AgentProviderId;
  accounts: readonly ProviderAccountStatus[];
  canAdd: boolean;
  busy: boolean;
  onAdd: () => void;
}) {
  const { t } = useText();
  const accountName = useProviderAccountName();
  return (
    <SettingsSection
      title={t("mobile.server.providers.accounts")}
      footer={t(canAdd ? "mobile.server.providers.accountsHint" : "mobile.server.providers.accountsOnComputer")}
    >
      {accounts.map((account, index) => {
        const name = accountName(account, index);
        return (
          <SettingsRow
            key={account.id}
            leading={<RowIcon icon={UserRound} />}
            supportingText={account.email && account.email !== name ? account.email : undefined}
            trailing={<TrailingValue value={t(providerAccountStateKey(account.state))} />}
            onPress={() =>
              router.push({
                pathname: "/server-settings/provider-account",
                params: { serverId, provider, accountId: account.id },
              })
            }
          >
            <Typography.Paragraph numberOfLines={1}>{name}</Typography.Paragraph>
          </SettingsRow>
        );
      })}
      {canAdd ? (
        <SettingsRow
          disclosure={false}
          disabled={busy}
          leading={<RowIcon icon={UserPlus} tone="accent" />}
          onPress={onAdd}
        >
          <Typography.Paragraph className="text-accent">{t("mobile.server.providers.addAccount")}</Typography.Paragraph>
        </SettingsRow>
      ) : null}
    </SettingsSection>
  );
}
