import {
  type AgentProviderId,
  isAgentProvider,
  isKeyOnlyProvider,
  type ProviderAccountStatus,
  relayCallbackQuery,
} from "@openbot/contracts/ipc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Spinner, Typography } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { Alert, Linking } from "react-native";
import { useCSSVariable } from "uniwind";
import { useProviderAccountName } from "@/features/agents/components/agent-runtime-fields";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { TrailingValue } from "@/features/servers/components/trailing-value";
import {
  type ProviderAdmin,
  providerAccountStateKey,
  providerRuntimeBusy,
  relayPage,
} from "@/features/servers/model/provider-admin";
import { useServerProviderAccounts, useServerProviders } from "@/features/servers/model/use-server-providers";
import { providerStatusLabel } from "@/features/servers/screens/server-providers-screen";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";

/** How often the host is asked how a relayed sign-in is, as on the web. */
const RELAY_POLL_MS = 1000;

/** A sign-in that runs on the host while this page shows it. */
type SignIn =
  | { kind: "starting" }
  /** A device code that the user types on the provider's page. */
  | { kind: "code"; userCode: string; url: string }
  /** The provider's page shows a code that the user pastes back here. */
  | { kind: "paste"; url: string }
  /** The provider sees the sign-in on the page by itself. */
  | { kind: "link"; url: string }
  /** `sign-in-relay-v1`: the host waits for its page; `paste` pages return to the host's loopback address. */
  | { kind: "relay"; flowId: string; page: { url: string; state: string | null; paste: boolean } | null };

/**
 * Server settings > Providers > one provider of the host: its status, its sign-in, the download or
 * update of its CLI, and its API key. The host checks the role on every request. A code or key goes
 * to the host only, and the phone does not keep it.
 */
export function ServerProviderScreen() {
  const text = useText();
  const { t, sourceText, errorMessage } = text;
  const params = useLocalSearchParams<{ serverId: string; provider: string; signInAccount?: string }>();
  const serverId = params.serverId;
  const provider = isAgentProvider(params.provider) ? params.provider : null;
  const [signIn, setSignIn] = useState<SignIn | null>(null);
  const providers = useServerProviders(serverId, { watchStatus: signIn !== null && signIn.kind !== "relay" });
  const { available, admin, status, rows, applyStatus, applyRuntimes, refreshStatus } = providers;
  const accounts = useServerProviderAccounts(serverId, admin);
  const refreshAccounts = accounts.refresh;
  const row = rows.find((candidate) => candidate.id === provider);
  const locked = useRef(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  /** The last check found no update, so the page says the provider is up to date. */
  const [checked, setChecked] = useState(false);

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

  // A sign-in ends on the provider's page. The host then reports the provider connected. A Reconnect
  // starts while the provider is connected, so it ends only after the host reported the sign-in as
  // running: the host marks the provider `connecting` until the sign-in ends.
  const state = row?.status?.state;
  const connecting = row?.status?.connectionState === "connecting";
  const [reconnecting, setReconnecting] = useState(false);
  const [sawConnecting, setSawConnecting] = useState(false);
  useEffect(() => {
    if (signIn !== null && connecting) setSawConnecting(true);
  }, [signIn, connecting]);
  useEffect(() => {
    if (state !== "available" || signIn === null || signIn.kind === "relay" || signIn.kind === "starting") return;
    if (reconnecting && (connecting || !sawConnecting)) return;
    setSignIn(null);
    setCode("");
    void haptics.notification("success");
  }, [state, connecting, signIn, reconnecting, sawConnecting]);

  // The host keeps a sign-in open until it ends or is cancelled, so leaving the page cancels it.
  const active = useRef<{ admin: ProviderAdmin; signIn: SignIn; provider: AgentProviderId } | null>(null);
  useEffect(() => {
    active.current = admin && provider && signIn && signIn.kind !== "starting" ? { admin, signIn, provider } : null;
  }, [admin, provider, signIn]);
  // A start that answers after the page closed is cancelled where it resolves, in `startSignIn`.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const current = active.current;
      if (current) void cancelSignIn(current.admin, current.provider, current.signIn).catch(() => undefined);
    };
  }, []);

  const relayFlow = signIn?.kind === "relay" ? signIn.flowId : null;
  const relayReady = signIn?.kind === "relay" && signIn.page !== null;
  useEffect(() => {
    if (!admin || !relayFlow) return;
    let current = true;
    const timer = setInterval(() => {
      admin.relayStatus(relayFlow).then(
        (relay) => {
          if (!current) return;
          if (relay.result) {
            setSignIn(null);
            setAddress("");
            if (relay.result.error) {
              setError(sourceText(relay.result.error));
              void haptics.notification("error");
            } else void haptics.notification("success");
            void refreshStatus();
            void refreshAccounts();
            return;
          }
          if (!relay.authorizeUrl || relayReady) return;
          const page = relayPage(relay.authorizeUrl);
          if ("error" in page) {
            setSignIn(null);
            setError(currentText().t(page.error));
            void admin.cancelRelay(relayFlow).then(applyStatus, () => undefined);
            return;
          }
          setSignIn({ kind: "relay", flowId: relayFlow, page });
          // The user asked for the sign-in with Connect, so the page opens without a second tap.
          void Linking.openURL(page.url).catch(() => setError(currentText().t("mobile.server.providers.openFailed")));
        },
        // The host forgets a flow that expired or that a restart ended, and refuses its status.
        (cause: unknown) => {
          if (!current) return;
          setSignIn(null);
          setAddress("");
          setError(currentText().errorMessage(cause, currentText().t("mobile.server.providers.actionFailed")));
          void haptics.notification("error");
        },
      );
    }, RELAY_POLL_MS);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [admin, relayFlow, relayReady, sourceText, applyStatus, refreshStatus, refreshAccounts]);

  // The account page asks for a sign-in of one account, which runs here. The request runs once.
  const requestedAccount = params.signInAccount;
  const startAccountSignIn = useRef<(account: string) => boolean>(() => false);
  useEffect(() => {
    // A sign-in or another action that runs keeps the request until it ends.
    if (!requestedAccount || !row || pending !== null) return;
    if (startAccountSignIn.current(requestedAccount)) router.setParams({ signInAccount: undefined });
  }, [requestedAccount, row, pending]);

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

  /** `account` relays the sign-in of an account after the first: a string signs it in again, null adds one. */
  function startSignIn(method: "code" | "relay", account?: string | null) {
    if (!admin || !provider || locked.current) return;
    setReconnecting(state === "available");
    setSawConnecting(false);
    setSignIn({ kind: "starting" });
    void run("sign-in", async () => {
      try {
        if (method === "relay") {
          const flowId =
            account !== undefined && admin.accounts
              ? await admin.accounts.startRelay(provider, account)
              : await admin.startRelay(provider);
          if (!mounted.current) {
            void admin.cancelRelay(flowId).catch(() => undefined);
            return;
          }
          setSignIn({ kind: "relay", flowId, page: null });
          return;
        }
        const started = await admin.startCodeSignIn(provider);
        if (!mounted.current) {
          if (started.kind !== "connected") void admin.cancelCodeSignIn(provider).catch(() => undefined);
          return;
        }
        if (started.kind === "connected") {
          setSignIn(null);
          await applyStatus(await admin.readStatus());
          return;
        }
        if (started.kind === "code") {
          setSignIn({
            kind: "code",
            userCode: started.userCode,
            url: started.verificationUrlComplete ?? started.verificationUrl,
          });
          return;
        }
        setSignIn({ kind: started.kind, url: started.verificationUrl });
      } catch (cause) {
        setSignIn(null);
        throw cause;
      }
    });
  }

  startAccountSignIn.current = (account) => {
    if (signIn !== null || locked.current) return false;
    startSignIn("relay", account);
    return true;
  };

  function openPage(url: string) {
    void Linking.openURL(url).catch(() => setError(t("mobile.server.providers.openFailed")));
  }

  const busy = pending !== null;
  const runtime = row.runtime;
  // A download can be cancelled; the setup step after it cannot. An update downloads the newer version.
  // An installed runtime with no update offers a check, as the row menu of the desktop tab does.
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
              : "check";
  // A provider whose CLI is not on the host yet downloads before it signs in.
  // As on desktop, a connected provider offers Reconnect: the same sign-in, for another account or
  // a sign-in that the provider no longer accepts.
  const connectable = (!runtime || runtime.phase === "ready") && signIn === null;
  const connect = row.signIn;
  const version = runtime?.version ?? row.status?.version ?? null;
  // The host lists only a provider that can hold more than one account.
  const providerAccounts = accounts.list.data?.providers.find((entry) => entry.provider === provider)?.accounts;
  const message = row.status?.message ?? row.status?.checkError ?? null;

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
      {connectable && connect ? (
        <SettingsSection
          footer={
            connect === "relay" ? t("mobile.server.providers.relayHint") : t("mobile.server.providers.connectHint")
          }
        >
          <SettingsRow disclosure={false} disabled={busy} onPress={() => startSignIn(connect)}>
            <Typography.Paragraph className="text-accent">
              {t(state === "available" ? "mobile.server.providers.reconnect" : "mobile.server.providers.connect")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : connectable && state !== "available" && !(row.apiKey && isKeyOnlyProvider(provider)) ? (
        <SettingsNote>{t("mobile.server.providers.connectOnComputer")}</SettingsNote>
      ) : null}
      {signIn ? (
        <SignInSection
          signIn={signIn}
          busy={busy}
          code={code}
          address={address}
          onCode={setCode}
          onAddress={setAddress}
          onOpen={openPage}
          onCopy={(value) =>
            void Clipboard.setStringAsync(value).then(
              () => haptics.notification("success"),
              () => setError(t("mobile.server.providers.copyFailed")),
            )
          }
          onSubmitCode={() =>
            void run("submit", async () => {
              // The host only gives the code to the CLI. The sign-in stays open, so the status is
              // read until the host reports the provider connected.
              await applyStatus(await admin.submitCode(provider, code.trim()));
              setCode("");
            })
          }
          onSubmitAddress={() =>
            void run("submit", async () => {
              if (signIn.kind !== "relay" || !signIn.page) return;
              const query = relayCallbackQuery(address, signIn.page.state);
              if (query === null) throw new Error(currentText().t("mobile.server.providers.relayAddressInvalid"));
              const relay = await admin.completeRelay(signIn.flowId, query);
              if (relay.result?.error) throw new Error(sourceText(relay.result.error));
              if (relay.result) {
                setSignIn(null);
                setAddress("");
                await refreshStatus();
                void refreshAccounts();
              }
            })
          }
          onCancel={() =>
            void run("cancel", async () => {
              const current = signIn;
              setSignIn(null);
              setCode("");
              setAddress("");
              await applyStatus(await cancelSignIn(admin, provider, current));
              void refreshAccounts();
            })
          }
        />
      ) : null}
      {providerAccounts && providerAccounts.length > 0 ? (
        <ProviderAccountsSection
          serverId={serverId}
          provider={provider}
          accounts={providerAccounts}
          canAdd={signIn === null && connectable && admin.accounts?.canSignIn(provider) === true}
          busy={busy}
          onAdd={() => startSignIn("relay", null)}
        />
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
      {/* One save action at a time in the header: the sign-in's pasted value, or the key. */}
      {row.apiKey && signIn === null ? (
        <ProviderKeySection serverId={serverId} admin={admin} provider={provider} onStatus={applyStatus} />
      ) : null}
    </SettingsContent>
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

/** Asks the host to end a sign-in. It answers with its status after it. */
function cancelSignIn(admin: ProviderAdmin, provider: AgentProviderId, signIn: SignIn) {
  if (signIn.kind === "relay") return admin.cancelRelay(signIn.flowId);
  return admin.cancelCodeSignIn(provider);
}

function SignInSection({
  signIn,
  busy,
  code,
  address,
  onCode,
  onAddress,
  onOpen,
  onCopy,
  onSubmitCode,
  onSubmitAddress,
  onCancel,
}: {
  signIn: SignIn;
  busy: boolean;
  code: string;
  address: string;
  onCode: (value: string) => void;
  onAddress: (value: string) => void;
  onOpen: (url: string) => void;
  onCopy: (value: string) => void;
  onSubmitCode: () => void;
  onSubmitAddress: () => void;
  onCancel: () => void;
}) {
  const { t } = useText();
  const accent = String(useCSSVariable("--openbot-accent"));
  // The host needs a moment to start the sign-in and to get the page. The row says what it waits for.
  const waiting =
    signIn.kind === "starting"
      ? t("mobile.server.providers.starting")
      : signIn.kind === "relay" && !signIn.page
        ? t("mobile.server.providers.relayWaiting")
        : null;
  const url = signIn.kind === "starting" ? null : signIn.kind === "relay" ? (signIn.page?.url ?? null) : signIn.url;
  const footer =
    signIn.kind === "starting"
      ? undefined
      : signIn.kind === "code"
        ? t("mobile.server.providers.codeHint")
        : signIn.kind === "paste"
          ? t("mobile.server.providers.pasteHint")
          : signIn.kind === "link"
            ? t("mobile.server.providers.linkHint")
            : !signIn.page
              ? undefined
              : signIn.page.paste
                ? t("mobile.server.providers.relayPasteHint")
                : t("mobile.server.providers.linkHint");
  return (
    <>
      <SettingsSection title={t("mobile.server.providers.signIn")} footer={footer}>
        {waiting ? (
          <SettingsRow disclosure={false} trailing={<Spinner size="sm" color={accent} />}>
            <Typography.Paragraph className="text-grouped-secondary">{waiting}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {signIn.kind === "code" ? (
          <SettingsRow
            disclosure={false}
            accessibilityLabel={t("mobile.server.providers.copyCode")}
            trailing={
              <Typography.Paragraph className="text-accent">{t("mobile.server.providers.copy")}</Typography.Paragraph>
            }
            onPress={() => onCopy(signIn.userCode)}
          >
            <Typography.Heading type="h4" selectable>
              {signIn.userCode}
            </Typography.Heading>
          </SettingsRow>
        ) : null}
        {url ? (
          <SettingsRow disclosure={false} onPress={() => onOpen(url)}>
            <Typography.Paragraph className="text-accent">{t("mobile.server.providers.openPage")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {signIn.kind === "starting" ? null : (
          <SettingsRow disclosure={false} disabled={busy} onPress={onCancel}>
            <Typography.Paragraph className="text-danger-text">{t("common.cancel")}</Typography.Paragraph>
          </SettingsRow>
        )}
      </SettingsSection>
      {signIn.kind === "paste" ? (
        <PastedValue
          label={t("mobile.server.providers.code")}
          value={code}
          busy={busy}
          onChange={onCode}
          onSubmit={onSubmitCode}
        />
      ) : null}
      {signIn.kind === "relay" && signIn.page?.paste ? (
        <PastedValue
          label={t("mobile.server.providers.address")}
          value={address}
          busy={busy}
          onChange={onAddress}
          onSubmit={onSubmitAddress}
        />
      ) : null}
    </>
  );
}

/** A code or an address that the user pastes back from the provider's page. */
function PastedValue({
  label,
  value,
  busy,
  onChange,
  onSubmit,
}: {
  label: string;
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const { t } = useText();
  return (
    <>
      <SheetFormField
        label={label}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
        value={value}
        returnKeyType="done"
        onChangeText={onChange}
        onSubmitEditing={() => {
          if (value.trim()) onSubmit();
        }}
      />
      <SheetSaveAction
        dirty={value.trim().length > 0}
        canSave
        pending={busy}
        label={t("mobile.server.providers.finish")}
        pendingLabel={t("mobile.server.providers.finishing")}
        onSave={onSubmit}
      />
    </>
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
      <SheetFormField
        label={t(saved ? "mobile.server.providers.replaceKey" : "mobile.server.providers.newKey")}
        placeholder={t("mobile.server.providers.keyPlaceholder")}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        editable={!saving}
        maxLength={512}
        value={draft}
        onChangeText={(value) => {
          setDraft(value);
          setError(null);
        }}
      />
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
