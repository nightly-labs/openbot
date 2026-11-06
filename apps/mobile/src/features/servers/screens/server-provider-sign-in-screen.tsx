import { type AgentProviderId, isAgentProvider, relayCallbackQuery } from "@openbot/contracts/ipc";
import * as Clipboard from "expo-clipboard";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Spinner, Typography } from "heroui-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, View } from "react-native";
import { useCSSVariable } from "uniwind";
import { PasteButton } from "@/features/servers/components/paste-button";
import { type ProviderAdmin, relayPage } from "@/features/servers/model/provider-admin";
import { useRefreshProviderAccounts, useServerProviders } from "@/features/servers/model/use-server-providers";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
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
 * Server settings > Providers > a provider > Connect, Reconnect or Add account: one sign-in of the
 * host's provider. The sign-in starts when the page opens and the page closes when it ends. Leaving
 * the page cancels it. A code goes to the host only, and the phone does not keep it.
 *
 * `account` signs in that account of the provider again and `add` adds an account, both on the page
 * that the host relays.
 */
export function ServerProviderSignInScreen() {
  const { t, sourceText, errorMessage } = useText();
  const params = useLocalSearchParams<{
    serverId: string;
    provider: string;
    method: string;
    account?: string;
    add?: string;
  }>();
  const serverId = params.serverId;
  const provider = isAgentProvider(params.provider) ? params.provider : null;
  const method = params.method === "code" || params.method === "relay" ? params.method : null;
  const account = params.account ? params.account : params.add === "1" ? null : undefined;
  const [signIn, setSignIn] = useState<SignIn | null>(null);
  const providers = useServerProviders(serverId, { watchStatus: signIn !== null && signIn.kind !== "relay" });
  const { available, admin, status, rows, applyStatus, refreshStatus } = providers;
  const refreshAccounts = useRefreshProviderAccounts(serverId);
  const row = rows.find((candidate) => candidate.id === provider);
  const locked = useRef(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");

  async function run(key: string, operation: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setPending(key);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      setError(errorMessage(cause, t("mobile.server.providers.actionFailed")));
      void haptics.notification("error");
    } finally {
      locked.current = false;
      setPending(null);
    }
  }

  /** Back to the page that opened the sign-in, or to the provider page when this page is the first. */
  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: "/server-settings/provider", params: { serverId, provider: params.provider } });
  }, [serverId, params.provider]);

  // The host keeps a sign-in open until it ends or is cancelled, so leaving the page cancels it.
  const active = useRef<{ admin: ProviderAdmin; signIn: SignIn; provider: AgentProviderId } | null>(null);
  /** The sign-in ended well: the page closes, and the provider page shows the new status. */
  const finished = useRef(false);
  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    active.current = null;
    void haptics.notification("success");
    void refreshStatus();
    void refreshAccounts();
    close();
  }, [refreshStatus, refreshAccounts, close]);

  // A code sign-in ends on the provider's page. The host then reports the provider connected. A
  // Reconnect starts while the provider is connected, so it ends only after the host reported the
  // sign-in as running: the host marks the provider `connecting` until the sign-in ends.
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
    finish();
  }, [state, connecting, signIn, reconnecting, sawConnecting, finish]);

  useEffect(() => {
    if (finished.current) return;
    active.current = admin && provider && signIn && signIn.kind !== "starting" ? { admin, signIn, provider } : null;
  }, [admin, provider, signIn]);
  // A start that answers after the page closed is cancelled where it resolves, in `startSignIn`. The
  // page under this one shows the status that the cancel answers, and a cancelled new account goes.
  const afterCancel = useRef({ applyStatus, refreshAccounts });
  afterCancel.current = { applyStatus, refreshAccounts };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const current = active.current;
      if (!current) return;
      const after = afterCancel.current;
      void cancelSignIn(current.admin, current.provider, current.signIn)
        .then(after.applyStatus, () => undefined)
        .finally(() => void after.refreshAccounts());
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
            if (!relay.result.error) {
              finish();
              return;
            }
            setSignIn(null);
            setAddress("");
            setError(sourceText(relay.result.error));
            void haptics.notification("error");
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
          // The user asked for the sign-in with Connect, so a page that finishes by itself opens
          // without a second tap. A page whose address the user brings back opens only after the
          // steps show, because the browser hides them.
          if (!page.paste)
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
  }, [admin, relayFlow, relayReady, sourceText, applyStatus, refreshStatus, refreshAccounts, finish]);

  function startSignIn() {
    if (!admin || !provider || !method || locked.current) return;
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
          await applyStatus(await admin.readStatus());
          finish();
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

  // The user asked for the sign-in on the provider page, so it starts once, when the host answers.
  // It waits for the status, which tells a Reconnect from a first Connect.
  const started = useRef(false);
  const ready = Boolean(admin && row && status.data);
  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    startSignIn();
  });

  if (!available || !admin || !provider || !method || !row || !status.data)
    return (
      <SettingsContent>
        <SettingsNote>
          {!available || !provider || !method
            ? t("mobile.server.providers.unavailable")
            : status.isError
              ? errorMessage(status.error, t("mobile.server.providers.loadFailed"))
              : t("mobile.server.providers.loading")}
        </SettingsNote>
      </SettingsContent>
    );

  const busy = pending !== null;
  const title =
    account === null
      ? t("mobile.server.providers.addAccount")
      : t("mobile.server.providers.signInTo", { name: row.name });

  return (
    <SettingsContent>
      <Stack.Screen options={{ title }} />
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="px-4 text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
      {signIn ? (
        <SignInSection
          signIn={signIn}
          chatgpt={provider === "codex"}
          busy={busy}
          code={code}
          address={address}
          onCode={setCode}
          onAddress={setAddress}
          onOpen={(url) => void Linking.openURL(url).catch(() => setError(t("mobile.server.providers.openFailed")))}
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
              if (relay.result) finish();
            })
          }
          // Leaving the page cancels the sign-in on the host.
          onCancel={close}
        />
      ) : (
        <SettingsSection>
          <SettingsRow disclosure={false} disabled={busy} onPress={startSignIn}>
            <Typography.Paragraph className="text-accent">{t("mobile.server.providers.retry")}</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      )}
    </SettingsContent>
  );
}

/** Asks the host to end a sign-in. It answers with its status after it. */
function cancelSignIn(admin: ProviderAdmin, provider: AgentProviderId, signIn: SignIn) {
  if (signIn.kind === "relay") return admin.cancelRelay(signIn.flowId);
  return admin.cancelCodeSignIn(provider);
}

function SignInSection({
  signIn,
  chatgpt,
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
  /** ChatGPT signs in with a code only when the account turned that on. */
  chatgpt: boolean;
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
  // The steps show before the page opens: in the browser, the user cannot see this screen.
  const steps =
    signIn.kind === "code"
      ? [
          ...(chatgpt ? [t("mobile.server.providers.codeStepChatgpt")] : []),
          t("mobile.server.providers.codeStepCopy"),
          t("mobile.server.providers.codeStepEnter"),
          t("mobile.server.providers.codeStepReturn"),
        ]
      : signIn.kind === "paste"
        ? [
            t("mobile.server.providers.pasteStepSignIn"),
            t("mobile.server.providers.pasteStepCopy"),
            t("mobile.server.providers.pasteStepReturn"),
          ]
        : signIn.kind === "relay" && signIn.page?.paste
          ? [
              t("mobile.server.providers.relayStepSignIn"),
              t("mobile.server.providers.relayStepBlank"),
              t("mobile.server.providers.relayStepCopy"),
              t("mobile.server.providers.relayStepReturn"),
            ]
          : null;
  const footer =
    signIn.kind === "link" || (signIn.kind === "relay" && signIn.page && !signIn.page.paste)
      ? t("mobile.server.providers.linkHint")
      : undefined;
  return (
    <>
      {steps ? (
        <SettingsSection>
          <SignInSteps steps={steps} />
        </SettingsSection>
      ) : null}
      <SettingsSection footer={footer}>
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
      </SettingsSection>
      {signIn.kind === "paste" ? (
        <PastedValue
          label={t("mobile.server.providers.code")}
          placeholder={t("mobile.server.providers.codePlaceholder")}
          value={code}
          busy={busy}
          onChange={onCode}
          onSubmit={onSubmitCode}
        />
      ) : null}
      {signIn.kind === "relay" && signIn.page?.paste ? (
        <PastedValue
          label={t("mobile.server.providers.address")}
          placeholder={t("mobile.server.providers.addressPlaceholder")}
          value={address}
          busy={busy}
          onChange={onAddress}
          onSubmit={onSubmitAddress}
        />
      ) : null}
      {signIn.kind === "starting" ? null : (
        <SettingsSection>
          <SettingsRow disclosure={false} disabled={busy} onPress={onCancel}>
            <Typography.Paragraph className="text-danger-text">{t("common.cancel")}</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      )}
    </>
  );
}

/** The numbered steps of a sign-in, in the order that the user does them. */
function SignInSteps({ steps }: { steps: readonly string[] }) {
  return (
    <View className="gap-3 px-4 py-3">
      {steps.map((step, index) => (
        <View key={step} className="flex-row gap-3">
          <View className="size-6 items-center justify-center rounded-full bg-control">
            <Typography.Paragraph type="body-xs">{index + 1}</Typography.Paragraph>
          </View>
          <Typography.Paragraph className="min-w-0 flex-1">{step}</Typography.Paragraph>
        </View>
      ))}
    </View>
  );
}

/** A code or an address that the user pastes back from the provider's page. */
function PastedValue({
  label,
  placeholder,
  value,
  busy,
  onChange,
  onSubmit,
}: {
  label: string;
  placeholder: string;
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
        placeholder={placeholder}
        trailing={<PasteButton disabled={busy} onPaste={onChange} />}
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
