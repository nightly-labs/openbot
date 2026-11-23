import {
  type AgentProviderId,
  type AgentProviderStatus,
  claudeCompactWindowSizes,
  isAgentProvider,
  isInstallerProvider,
  isKeyOnlyProvider,
  isProviderEnvironmentProvider,
  PROMPT_CACHE_TTLS,
  type PromptCacheTtl,
  type ProviderAccountPool,
  type ProviderAccountStatus,
  type ProviderApiKeyStatus,
} from "@openbot/contracts/ipc";
import { CLAUDE_API_KEY_ACCOUNT_ID } from "@openbot/contracts/team-protocol/claude-api-key-v1";
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
import Smartphone from "lucide-react-native/icons/smartphone";
import Star from "lucide-react-native/icons/star";
import UserPlus from "lucide-react-native/icons/user-plus";
import UserRound from "lucide-react-native/icons/user-round";
import Users from "lucide-react-native/icons/users";
import Variable from "lucide-react-native/icons/variable";
import X from "lucide-react-native/icons/x";
import { useRef, useState } from "react";
import { Alert, View } from "react-native";
import { useUniwind } from "uniwind";
import { useProviderAccountName } from "@/features/agents/components/agent-runtime-fields";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { ProviderMark } from "@/features/servers/components/provider-mark";
import { TrailingValue } from "@/features/servers/components/trailing-value";
import {
  isProviderKeyAccount,
  type ProviderAdmin,
  type ProviderRow,
  providerAccountStateKey,
  providerAccountsAreKeys,
  providerRuntimeBusy,
  providerSignOutOffered,
} from "@/features/servers/model/provider-admin";
import { useOpenSignIn } from "@/features/servers/model/use-open-sign-in";
import { useProviderModels } from "@/features/servers/model/use-provider-models";
import {
  useHostProviderDefault,
  useProviderKeyState,
  useProviderSetting,
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

const VERSION_SOURCE_KEYS = {
  system: "mobile.server.providers.versionInstalledByUser",
  managed: "mobile.server.providers.versionDownloaded",
} as const satisfies Record<NonNullable<AgentProviderStatus["cliSource"]>, string>;

function providerStatusColor(row: ProviderRow): "success" | "warning" | "danger" | "accent" | "default" {
  const state = row.status?.state;
  if (row.status?.off) return "default";
  if (providerRuntimeBusy(row) || (row.status?.connectionState === "connecting" && state !== "available"))
    return "accent";
  if (row.runtime?.phase === "download-error" || state === "error") return "danger";
  if (row.updatable || state === "outdated") return "warning";
  return state === "available" ? "success" : "default";
}

function keyDescription(row: ProviderRow, key: ProviderApiKeyStatus | undefined, { t }: Pick<MobileText, "t">) {
  const saved = key === "saved";
  if (row.id === "opencode") return t("mobile.server.providers.keyOptional");
  if (row.id === "antigravity" && saved) return t("mobile.server.providers.geminiKeyInUse");
  if (row.id === "claude" && saved) return t("mobile.server.providers.claudeKeyInUse");
  if (row.id === "muse" && saved) return t("mobile.server.providers.museKeyInUse");
  if (row.id === "codex")
    return t(saved ? "mobile.server.providers.codexKeyInUse" : "mobile.server.providers.codexKeyAlternative");
  if (isKeyOnlyProvider(row.id)) return t("mobile.server.providers.keyHint");
  return undefined;
}

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
  const models = useProviderModels(serverId, row?.status?.off ? null : provider, admin);
  const keyState = useProviderKeyState(serverId, row?.apiKey ? admin : null, provider);
  const defaultProvider = useHostProviderDefault(serverId, admin?.defaultProvider ?? null);
  const { agents } = useMobileWorkspace();
  const locked = useRef(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  function openSignIn(method: "code" | "relay" | "account-code", extra: { add?: "1" } = {}) {
    if (provider) openSignInPage({ serverId, provider, method, ...extra });
  }

  const busy = pending !== null;
  const runtime = row.runtime;
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
  const connectable = !runtime || runtime.phase === "ready";
  const connect = row.signIn;
  const alternative = connectable ? row.alternativeSignIn : null;
  const version = runtime?.version ?? row.status?.version ?? null;
  const cliSource = row.status?.cliSource;
  const providerAccounts = accounts.list.data?.providers.find((entry) => entry.provider === provider)?.accounts;
  const hasAccounts = Boolean(providerAccounts && providerAccounts.length > 0);
  const setPool = admin.accounts?.setPool ?? null;
  const pool = setPool ? accounts.list.data?.pools?.find((entry) => entry.provider === provider)?.pool : undefined;
  const message = row.status?.message ?? row.status?.checkError ?? null;
  const signOut = admin.signOut;
  const keySaved = row.apiKey && keyState.data === "saved";
  const disconnectable = signOut !== null && providerSignOutOffered(row) && !keySaved && !hasAccounts;
  const off = row.status?.off === true;
  const modelList = models.list.data;
  const modelsShown = !off && models.available && ((modelList?.models.length ?? 0) > 0 || models.list.isError);
  const users = agents.filter((agent) => agent.serverId === serverId && agent.provider === provider);
  const isDefault = defaultProvider.current.data?.provider === provider;
  const connectOnComputer =
    connectable && !connect && state !== "available" && !(row.apiKey && isKeyOnlyProvider(provider));
  const keyAccounts = providerAccountsAreKeys(provider);
  const connectKey = admin.accounts?.connectKey ?? null;
  const signInShown = hasAccounts
    ? keyAccounts && connectable && Boolean(connect)
    : Boolean(row.status?.email) || (connectable && Boolean(connect)) || disconnectable;

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
          {row.status?.email && !hasAccounts ? (
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
          canAdd={connectable && (keyAccounts ? connectKey !== null : admin.accounts?.canSignIn(provider) === true)}
          canAddWithCode={connectable && !keyAccounts && admin.accounts?.code?.offered(provider) === true}
          keyAccounts={keyAccounts}
          busy={busy}
          onAddWithCode={() => openSignIn("account-code", { add: "1" })}
          onAdd={() =>
            keyAccounts
              ? router.push({ pathname: "/server-settings/provider-key", params: { serverId, provider, add: "1" } })
              : openSignIn("relay", { add: "1" })
          }
          pool={pool}
          onPoolChange={
            setPool
              ? (enabled) =>
                  void run("pool", async () => {
                    await setPool(provider, enabled, pool?.leftOut ?? []);
                    await accounts.refresh();
                  })
              : null
          }
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
      {!off && admin.environment && isProviderEnvironmentProvider(provider) ? (
        <SettingsSection title={t("mobile.server.environment.title")}>
          <SettingsRow
            leading={<RowIcon icon={Variable} />}
            onPress={() =>
              router.push({ pathname: "/server-settings/provider-environment", params: { serverId, provider } })
            }
          >
            <Typography.Paragraph>{t("mobile.server.environment.row")}</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
      {(provider === "claude" || (provider === "pi" && admin.promptCache?.appliesToPi)) && !off && admin.promptCache ? (
        <PromptCacheSection serverId={serverId} setting={admin.promptCache} />
      ) : null}
      {(provider === "claude" || (provider === "pi" && admin.promptCache?.appliesToPi)) &&
      !off &&
      admin.cacheExpiryCompaction ? (
        <CacheExpiryCompactionSection serverId={serverId} setting={admin.cacheExpiryCompaction} />
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
  const { current, saving, error, save } = useProviderSetting(
    queryKeys.providerPromptCache(queryScope, serverId),
    setting,
  );
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
                save(ttl);
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

function CacheExpiryCompactionSection({
  serverId,
  setting,
}: {
  serverId: string;
  setting: NonNullable<ProviderAdmin["cacheExpiryCompaction"]>;
}) {
  const { t, errorMessage } = useText();
  const { theme } = useUniwind();
  const queryScope = useQueryScope();
  const { current, saving, error, save } = useProviderSetting(
    queryKeys.providerCacheExpiryCompaction(queryScope, serverId),
    setting,
  );
  return (
    <SettingsSection
      footer={
        error ??
        (current.isError
          ? errorMessage(current.error, t("mobile.server.providers.cacheExpiryCompactionLoadFailed"))
          : t("mobile.server.providers.cacheExpiryCompactionHint"))
      }
    >
      <SettingsRow leading={<RowIcon icon={Minimize2} />}>
        <SettingsSwitch
          value={current.data?.enabled === true}
          disabled={saving || !current.isSuccess}
          label={t("mobile.server.providers.cacheExpiryCompaction")}
          dark={theme === "dark"}
          onValueChange={(enabled) => save(enabled)}
        />
      </SettingsRow>
    </SettingsSection>
  );
}

type CompactWindowChoice = "default" | `${number}`;

function compactWindowChoice(tokens: number | null): CompactWindowChoice {
  return tokens === null ? "default" : `${tokens}`;
}

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
  const { current, saving, error, save } = useProviderSetting(
    queryKeys.providerCompactWindow(queryScope, serverId),
    setting,
  );
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
                save(choice === "default" ? null : Number(choice));
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

function ProviderAccountsSection({
  serverId,
  provider,
  accounts,
  canAdd,
  canAddWithCode,
  keyAccounts,
  busy,
  onAdd,
  onAddWithCode,
  pool,
  onPoolChange,
}: {
  serverId: string;
  provider: AgentProviderId;
  accounts: readonly ProviderAccountStatus[];
  canAdd: boolean;
  canAddWithCode: boolean;
  keyAccounts: boolean;
  busy: boolean;
  onAdd: () => void;
  onAddWithCode: () => void;
  pool: ProviderAccountPool | undefined;
  onPoolChange: ((enabled: boolean) => void) | null;
}) {
  const { t } = useText();
  const { theme } = useUniwind();
  const accountName = useProviderAccountName();
  const planAccounts = accounts.filter(
    (account) => account.id !== CLAUDE_API_KEY_ACCOUNT_ID && !isProviderKeyAccount(provider, account.id),
  );
  const poolOffered = onPoolChange !== null && (planAccounts.length > 1 || Boolean(pool));
  return (
    <SettingsSection
      title={t("mobile.server.providers.accounts")}
      footer={t(
        keyAccounts && canAdd
          ? "mobile.server.providers.accountsKeyHint"
          : pool
            ? canAdd || canAddWithCode
              ? "mobile.server.providers.accountsPooledHint"
              : "mobile.server.providers.accountsPooledOnComputer"
            : canAdd || canAddWithCode
              ? "mobile.server.providers.accountsHint"
              : "mobile.server.providers.accountsOnComputer",
      )}
    >
      {poolOffered ? (
        <SettingsRow leading={<RowIcon icon={Users} />} supportingText={t("mobile.server.providers.poolHint")}>
          <SettingsSwitch
            value={Boolean(pool)}
            disabled={busy}
            label={t("mobile.server.providers.pool")}
            dark={theme === "dark"}
            onValueChange={(enabled) => onPoolChange?.(enabled)}
          />
        </SettingsRow>
      ) : null}
      {accounts.map((account, index) => {
        const name = accountName(account, index);
        const member = account.id !== CLAUDE_API_KEY_ACCOUNT_ID && !isProviderKeyAccount(provider, account.id);
        const leftOut = member && pool?.leftOut.includes(account.id) === true;
        const inUse = member && !leftOut && pool?.inUse === account.id;
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
            <View className="shrink flex-row items-center gap-2">
              <Typography.Paragraph numberOfLines={1} className="shrink">
                {name}
              </Typography.Paragraph>
              {leftOut || inUse ? (
                <Chip
                  size="sm"
                  variant="soft"
                  color={inUse ? "success" : "default"}
                  className="self-center"
                  accessibilityRole="text"
                >
                  <Chip.Label>
                    {t(inUse ? "mobile.server.providers.inUse" : "mobile.server.providers.notInPool")}
                  </Chip.Label>
                </Chip>
              ) : null}
            </View>
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
      {canAddWithCode ? (
        <SettingsRow
          disclosure={false}
          disabled={busy}
          leading={<RowIcon icon={Smartphone} tone="accent" />}
          onPress={onAddWithCode}
        >
          <Typography.Paragraph className="text-accent">
            {t("mobile.server.providers.addAccountWithCode")}
          </Typography.Paragraph>
        </SettingsRow>
      ) : null}
    </SettingsSection>
  );
}
