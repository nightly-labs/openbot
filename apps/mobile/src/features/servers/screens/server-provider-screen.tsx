import {
  type AgentProviderId,
  isAgentProvider,
  isInstallerProvider,
  isKeyOnlyProvider,
  PROMPT_CACHE_TTLS,
  type PromptCacheTtl,
  type ProviderAccountStatus,
} from "@openbot/contracts/ipc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useRef, useState } from "react";
import { Alert } from "react-native";
import { useUniwind } from "uniwind";
import { useProviderAccountName } from "@/features/agents/components/agent-runtime-fields";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { PasteButton } from "@/features/servers/components/paste-button";
import { TrailingValue } from "@/features/servers/components/trailing-value";
import {
  type ProviderAdmin,
  providerAccountStateKey,
  providerRuntimeBusy,
  providerSignOutOffered,
} from "@/features/servers/model/provider-admin";
import { useOpenSignIn } from "@/features/servers/model/use-open-sign-in";
import { useProviderModels } from "@/features/servers/model/use-provider-models";
import { useServerProviderAccounts, useServerProviders } from "@/features/servers/model/use-server-providers";
import { providerStatusLabel } from "@/features/servers/screens/server-providers-screen";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { SettingsPicker } from "@/features/settings/components/settings-controls";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";

/**
 * Server settings > Providers > one provider of the host: its status, its sign-in, the download or
 * update of its CLI, and its API key. The host checks the role on every request. A code or key goes
 * to the host only, and the phone does not keep it.
 */
export function ServerProviderScreen() {
  const text = useText();
  const { t, sourceText, errorMessage } = text;
  const params = useLocalSearchParams<{ serverId: string; provider: string }>();
  const serverId = params.serverId;
  const provider = isAgentProvider(params.provider) ? params.provider : null;
  const providers = useServerProviders(serverId);
  const { available, admin, status, rows, applyStatus, applyRuntimes, refreshStatus } = providers;
  const accounts = useServerProviderAccounts(serverId, admin);
  const row = rows.find((candidate) => candidate.id === provider);
  // A provider that is off has no Models row, so the page does not read its list.
  const models = useProviderModels(serverId, row?.status?.off ? null : provider, admin);
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
  const runtimeAction =
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
  const version = runtime?.version ?? row.status?.version ?? null;
  // The host lists only a provider that can hold more than one account.
  const providerAccounts = accounts.list.data?.providers.find((entry) => entry.provider === provider)?.accounts;
  const message = row.status?.message ?? row.status?.checkError ?? null;
  const signOut = admin.signOut;
  // With an accounts list, the provider's own account offers Disconnect on its page, as on desktop.
  const disconnectable =
    signOut !== null && providerSignOutOffered(row) && !(providerAccounts && providerAccounts.length > 0);
  const off = row.status?.off === true;
  const modelList = models.list.data;
  // As on desktop, a provider that lists no model has no Models row.
  const modelsShown = !off && models.available && ((modelList?.models.length ?? 0) > 0 || models.list.isError);

  const providerName = row.name;
  const signedInAs = row.status?.email ?? row.name;
  function disconnect() {
    if (!signOut || !provider) return;
    const target = provider;
    Alert.alert(
      currentText().t("mobile.server.providers.disconnectTitle", { name: signedInAs }),
      currentText().t("mobile.server.providers.disconnectBody", { provider: providerName }),
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
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="px-4 text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
      <SettingsSection footer={message ? sourceText(message) : t("mobile.server.providers.onHost")}>
        <SettingsRow
          disclosure={false}
          trailing={
            <Typography.Paragraph className="text-grouped-secondary">
              {providerStatusLabel(row, text)}
            </Typography.Paragraph>
          }
        >
          <Typography.Paragraph>{t("mobile.server.providers.statusLabel")}</Typography.Paragraph>
        </SettingsRow>
        {row.status?.email ? (
          <SettingsRow
            disclosure={false}
            trailing={
              <Typography.Paragraph numberOfLines={1} className="shrink text-grouped-secondary">
                {row.status.email}
              </Typography.Paragraph>
            }
          >
            <Typography.Paragraph>{t("mobile.server.providers.account")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {version ? (
          <SettingsRow
            disclosure={false}
            trailing={<Typography.Paragraph className="text-grouped-secondary">{version}</Typography.Paragraph>}
          >
            <Typography.Paragraph>{t("mobile.server.providers.version")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
      {providerAccounts && providerAccounts.length > 0 ? (
        <ProviderAccountsSection
          serverId={serverId}
          provider={provider}
          accounts={providerAccounts}
          canAdd={connectable && admin.accounts?.canSignIn(provider) === true}
          busy={busy}
          onAdd={() => openSignIn("relay", { add: "1" })}
        />
      ) : null}
      {row.apiKey ? (
        <ProviderKeySection serverId={serverId} admin={admin} provider={provider} onStatus={applyStatus} />
      ) : null}
      {modelsShown ? (
        <SettingsSection
          footer={
            models.list.isError
              ? errorMessage(models.list.error, t("mobile.server.providers.modelsLoadFailed"))
              : undefined
          }
        >
          <SettingsRow
            disabled={!modelList}
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
        </SettingsSection>
      ) : null}
      {provider === "claude" && !off && admin.promptCache ? (
        <PromptCacheSection serverId={serverId} setting={admin.promptCache} />
      ) : null}
      {/* The actions come last, after what the page shows about the provider. */}
      {connectable && connect ? (
        <SettingsSection
          footer={
            connect === "relay" ? t("mobile.server.providers.relayHint") : t("mobile.server.providers.connectHint")
          }
        >
          <SettingsRow disclosure={false} disabled={busy} onPress={() => openSignIn(connect)}>
            <Typography.Paragraph className="text-accent">
              {t(state === "available" ? "mobile.server.providers.reconnect" : "mobile.server.providers.connect")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : connectable && state !== "available" && !(row.apiKey && isKeyOnlyProvider(provider)) ? (
        <SettingsNote>{t("mobile.server.providers.connectOnComputer")}</SettingsNote>
      ) : null}
      {disconnectable ? (
        <SettingsSection>
          <SettingsRow disclosure={false} disabled={busy} onPress={disconnect}>
            <Typography.Paragraph className="text-danger-text">
              {t("mobile.server.providers.disconnect")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
      {runtime && runtimeAction ? (
        <SettingsSection
          footer={
            runtime.phase === "download-error" && runtime.message
              ? sourceText(runtime.message)
              : row.updatable && runtime.availableVersion
                ? t("mobile.server.providers.updateHint", { version: runtime.availableVersion })
                : checked
                  ? t("mobile.server.providers.upToDate", { name: row.name })
                  : undefined
          }
        >
          <SettingsRow
            disclosure={false}
            disabled={busy}
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
              {t(
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
        <SettingsRow disclosure={false} disabled={busy} onPress={onAdd}>
          <Typography.Paragraph className="text-accent">{t("mobile.server.providers.addAccount")}</Typography.Paragraph>
        </SettingsRow>
      ) : null}
    </SettingsSection>
  );
}

/** The provider's API key on the host. Only its state comes back; the input is cleared after a save. */
function ProviderKeySection({
  serverId,
  admin,
  provider,
  onStatus,
}: {
  serverId: string;
  admin: ProviderAdmin;
  provider: AgentProviderId;
  onStatus: (status: Awaited<ReturnType<ProviderAdmin["setKey"]>>) => Promise<void>;
}) {
  const { t, errorMessage } = useText();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.providerKey(queryScope, serverId, provider);
  const keyState = useQuery({
    queryKey,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    queryFn: () => admin.keyState(provider),
  });
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);

  async function change(operation: () => Promise<Awaited<ReturnType<ProviderAdmin["setKey"]>>>) {
    if (locked.current) return;
    locked.current = true;
    setSaving(true);
    setError(null);
    try {
      await onStatus(await operation());
      setDraft("");
      await queryClient.invalidateQueries({ queryKey, exact: true });
      void haptics.notification("success");
    } catch (cause) {
      setError(errorMessage(cause, t("mobile.server.providers.keyFailed")));
      void haptics.notification("error");
    } finally {
      locked.current = false;
      setSaving(false);
    }
  }

  const saved = keyState.data === "saved";
  return (
    <>
      <SettingsSection
        title={t("mobile.server.providers.apiKey")}
        footer={
          error ??
          (keyState.isError
            ? errorMessage(keyState.error, t("mobile.server.providers.keyLoadFailed"))
            : keyState.data === "unreadable"
              ? t("mobile.server.providers.keyUnreadable")
              : t("mobile.server.providers.keyHint"))
        }
      >
        <SettingsRow
          disclosure={false}
          trailing={
            keyState.data ? (
              <Typography.Paragraph className="text-grouped-secondary">
                {t(saved ? "mobile.server.providers.keySaved" : "mobile.server.providers.keyMissing")}
              </Typography.Paragraph>
            ) : null
          }
        >
          <Typography.Paragraph>{t("mobile.server.providers.keyState")}</Typography.Paragraph>
        </SettingsRow>
        {/* The input is a row of the group, so the key reads as one section. */}
        <SheetFormField
          hideLabel
          appearance="soft"
          label={t(saved ? "mobile.server.providers.replaceKey" : "mobile.server.providers.newKey")}
          placeholder={t(
            saved ? "mobile.server.providers.replaceKeyPlaceholder" : "mobile.server.providers.keyPlaceholder",
          )}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          editable={!saving}
          trailing={
            <PasteButton
              disabled={saving}
              onPaste={(value) => {
                setDraft(value);
                setError(null);
              }}
            />
          }
          maxLength={512}
          value={draft}
          onChangeText={(value) => {
            setDraft(value);
            setError(null);
          }}
        />
        {saved ? (
          <SettingsRow
            disclosure={false}
            disabled={saving}
            onPress={() =>
              Alert.alert(currentText().t("mobile.server.providers.removeKeyTitle"), undefined, [
                { text: currentText().t("common.cancel"), style: "cancel" },
                {
                  text: currentText().t("mobile.server.providers.removeKey"),
                  style: "destructive",
                  onPress: () => void change(() => admin.clearKey(provider)),
                },
              ])
            }
          >
            <Typography.Paragraph className="text-danger-text">
              {t("mobile.server.providers.removeKey")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
      <SheetSaveAction
        dirty={draft.trim().length > 0}
        canSave
        pending={saving}
        label={t("mobile.server.providers.saveKey")}
        onSave={() => void change(() => admin.setKey(provider, draft.trim()))}
      />
    </>
  );
}
