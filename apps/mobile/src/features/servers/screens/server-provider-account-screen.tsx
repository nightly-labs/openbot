import {
  type AgentProviderId,
  agentProviderName,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  isAgentProvider,
  PROVIDER_ACCOUNT_LABEL_MAX_LENGTH,
  type ProviderAccountPool,
  type ProviderAccountStatus,
  type ProviderUsageResetOutcome,
} from "@openbot/contracts/ipc";
import { CLAUDE_API_KEY_ACCOUNT_ID } from "@openbot/contracts/team-protocol/claude-api-key-v1";
import { skipToken, useQuery } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import LogOut from "lucide-react-native/icons/log-out";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import RotateCcw from "lucide-react-native/icons/rotate-ccw";
import Trash2 from "lucide-react-native/icons/trash";
import UserMinus from "lucide-react-native/icons/user-minus";
import UserPlus from "lucide-react-native/icons/user-plus";
import { useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { useProviderAccountName } from "@/features/agents/components/agent-runtime-fields";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import {
  type ProviderAdmin,
  providerAccountStateKey,
  providerSignOutOffered,
} from "@/features/servers/model/provider-admin";
import { useOpenSignIn } from "@/features/servers/model/use-open-sign-in";
import { useServerProviderAccounts, useServerProviders } from "@/features/servers/model/use-server-providers";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { RowIcon } from "@/features/settings/components/settings-row-icon";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";

const RESET_OUTCOME_KEYS = {
  reset: "mobile.server.providers.resetUsageDone",
  nothingToReset: "mobile.server.providers.resetUsageNothing",
  noCredit: "mobile.server.providers.resetUsageNoCredit",
  alreadyRedeemed: "mobile.server.providers.resetUsageAlreadyRedeemed",
} as const satisfies Record<ProviderUsageResetOutcome, string>;

/**
 * Server settings > Providers > a provider > one of its accounts on the host: its name, its sign-in,
 * its place in the pool and its removal. A sign-in runs on the provider page, which has the relayed
 * sign-in.
 */
export function ServerProviderAccountScreen() {
  const { t, errorMessage } = useText();
  const params = useLocalSearchParams<{ serverId: string; provider: string; accountId: string }>();
  const provider = isAgentProvider(params.provider) ? params.provider : null;
  const { available, admin, rows, refreshStatus } = useServerProviders(params.serverId);
  const accounts = useServerProviderAccounts(params.serverId, admin);
  const list = accounts.list.data?.providers.find((entry) => entry.provider === provider)?.accounts ?? [];
  const index = list.findIndex((account) => account.id === params.accountId);
  const account = list[index];
  // The host lists a pool only while it is on, and an older host has no pool.
  const pool = admin?.accounts?.setPool
    ? accounts.list.data?.pools?.find((entry) => entry.provider === provider)?.pool
    : undefined;
  if (!available || !admin?.accounts || !provider || !account)
    return (
      <SettingsContent>
        <SettingsNote>
          {!available || !admin || !provider
            ? t("mobile.server.providers.unavailable")
            : accounts.list.isError
              ? errorMessage(accounts.list.error, t("mobile.server.providers.loadFailed"))
              : accounts.list.isPending
                ? t("mobile.server.providers.loading")
                : t("mobile.server.providers.accountGone")}
        </SettingsNote>
      </SettingsContent>
    );
  return (
    <AccountPage
      key={account.id}
      serverId={params.serverId}
      provider={provider}
      account={account}
      index={index}
      accounts={admin.accounts}
      pool={pool}
      usageResets={admin.usageResets}
      // The provider's own sign-in signs out on the host, as the desktop account menu offers it.
      signOut={
        account.id === DEFAULT_PROVIDER_ACCOUNT_ID &&
        account.state === "connected" &&
        admin.signOut &&
        rows.some((row) => row.id === provider && providerSignOutOffered(row))
          ? admin.signOut
          : null
      }
      onChanged={accounts.refresh}
      onStatusChanged={refreshStatus}
    />
  );
}

function AccountPage({
  serverId,
  provider,
  account,
  index,
  accounts,
  pool,
  usageResets,
  signOut,
  onChanged,
  onStatusChanged,
}: {
  serverId: string;
  provider: AgentProviderId;
  account: ProviderAccountStatus;
  index: number;
  accounts: NonNullable<ProviderAdmin["accounts"]>;
  /** The pool of the provider's accounts, while it is on. */
  pool: ProviderAccountPool | undefined;
  usageResets: ProviderAdmin["usageResets"];
  signOut: ProviderAdmin["signOut"];
  onChanged: () => Promise<void>;
  onStatusChanged: () => Promise<void>;
}) {
  const { t, sourceText, errorMessage } = useText();
  const accountName = useProviderAccountName();
  const name = accountName(account, index);
  const [label, setLabel] = useState(account.label ?? "");
  const [pending, setPending] = useState<"rename" | "remove" | "reset" | "sign-out" | "pool" | null>(null);
  /** How the last usage reset ended, when it did not fail. */
  const [notice, setNotice] = useState<string | null>(null);
  const queryScope = useQueryScope();
  const credits = useQuery({
    queryKey: queryKeys.providerUsageResets(queryScope, serverId, provider),
    retry: false,
    staleTime: 0,
    queryFn: usageResets && account.state === "connected" ? () => usageResets.list(provider) : skipToken,
  });
  const resetsLeft =
    account.state === "connected"
      ? (credits.data?.find((reading) => reading.accountId === account.id)?.available ?? 0)
      : 0;
  const openSignIn = useOpenSignIn();
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  // A removed account leaves the page before the list without it shows, so the page does not say "gone".
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (!leaving) return;
    router.back();
    void onChanged();
  }, [leaving, onChanged]);

  async function run(kind: "rename" | "remove" | "reset" | "sign-out" | "pool", operation: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setPending(kind);
    setError(null);
    setNotice(null);
    try {
      await operation();
      void haptics.notification("success");
      if (kind === "remove") setLeaving(true);
      // A reset changes no account; it reads its credits again.
      else if (kind !== "reset") await onChanged();
    } catch (cause) {
      setError(
        errorMessage(
          cause,
          t(kind === "reset" ? "mobile.server.providers.resetUsageFailed" : "mobile.server.providers.accountFailed"),
        ),
      );
      void haptics.notification("error");
    } finally {
      locked.current = false;
      setPending(null);
    }
  }

  const trimmed = label.trim();
  const dirty = trimmed !== (account.label ?? "");
  // The host keeps the provider's own sign-in, and only the key page removes the Claude API key account.
  const setPool = accounts.setPool;
  const apiKeyAccount = provider === "claude" && account.id === CLAUDE_API_KEY_ACCOUNT_ID;
  // A saved key has no plan limit, so it is not a pool member.
  const inPool = pool !== undefined && !apiKeyAccount && !pool.leftOut.includes(account.id);
  const removable = account.id !== DEFAULT_PROVIDER_ACCOUNT_ID && !apiKeyAccount;
  const value = (text: string) => (
    <Typography.Paragraph numberOfLines={1} className="shrink text-grouped-secondary">
      {text}
    </Typography.Paragraph>
  );
  return (
    <SettingsContent>
      <Stack.Screen options={{ title: name }} />
      <SheetSaveAction
        dirty={dirty}
        canSave={pending === null}
        pending={pending === "rename"}
        onSave={() => void run("rename", () => accounts.rename(provider, account.id, trimmed || null))}
      />
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="px-4 text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
      <SheetFormField
        label={t("mobile.server.providers.accountName")}
        placeholder={account.email ?? t("mobile.agent.runtime.accountNumbered", { number: index + 1 })}
        maxLength={PROVIDER_ACCOUNT_LABEL_MAX_LENGTH}
        editable={pending === null}
        value={label}
        hint={t("mobile.server.providers.accountNameHint")}
        onChangeText={(next) => {
          setLabel(next);
          setError(null);
        }}
      />
      <SettingsSection footer={account.message ? sourceText(account.message) : undefined}>
        <SettingsRow disclosure={false} trailing={value(t(providerAccountStateKey(account.state)))}>
          <Typography.Paragraph>{t("mobile.server.providers.statusLabel")}</Typography.Paragraph>
        </SettingsRow>
        {account.email ? (
          <SettingsRow disclosure={false} trailing={value(account.email)}>
            <Typography.Paragraph>{t("mobile.server.providers.account")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
      {accounts.canSignIn(provider) ? (
        <SettingsSection footer={t("mobile.server.providers.relayHint")}>
          <SettingsRow
            disclosure={false}
            disabled={pending !== null}
            leading={<RowIcon icon={RefreshCw} tone="accent" />}
            onPress={() =>
              // The sign-in page runs the relayed sign-in and comes back here when it ends.
              openSignIn({ serverId, provider, method: "relay", account: account.id })
            }
          >
            <Typography.Paragraph className="text-accent">
              {t("mobile.server.providers.accountSignInAgain")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
      {usageResets && resetsLeft > 0 ? (
        <SettingsSection footer={notice ?? t("mobile.server.providers.resetUsageHint", { available: resetsLeft })}>
          <SettingsRow
            disclosure={false}
            disabled={pending !== null}
            leading={<RowIcon icon={RotateCcw} tone="accent" />}
            onPress={() =>
              Alert.alert(
                t("mobile.server.providers.resetUsageTitle", { name }),
                t("mobile.server.providers.resetUsageBody"),
                [
                  { text: t("common.cancel"), style: "cancel" },
                  {
                    text: t("mobile.server.providers.resetUsage"),
                    onPress: () =>
                      void run("reset", async () => {
                        try {
                          const outcome = await usageResets.reset(provider, account.id);
                          setNotice(currentText().t(RESET_OUTCOME_KEYS[outcome], { name }));
                        } finally {
                          void credits.refetch();
                        }
                      }),
                  },
                ],
              )
            }
          >
            <Typography.Paragraph className="text-accent">
              {t(pending === "reset" ? "mobile.server.providers.resettingUsage" : "mobile.server.providers.resetUsage")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : notice ? (
        <SettingsNote>{notice}</SettingsNote>
      ) : null}
      {pool && !apiKeyAccount && setPool ? (
        <SettingsSection>
          <SettingsRow
            disclosure={false}
            disabled={pending !== null}
            leading={<RowIcon icon={inPool ? UserMinus : UserPlus} tone="accent" />}
            onPress={() =>
              void run("pool", () =>
                setPool(
                  provider,
                  true,
                  inPool ? [...pool.leftOut, account.id] : pool.leftOut.filter((id) => id !== account.id),
                ),
              )
            }
          >
            <Typography.Paragraph className="text-accent">
              {t(inPool ? "mobile.server.providers.leaveOutOfPool" : "mobile.server.providers.putBackInPool")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
      {signOut ? (
        <SettingsSection>
          <SettingsRow
            disclosure={false}
            disabled={pending !== null}
            leading={<RowIcon icon={LogOut} tone="danger" />}
            onPress={() =>
              Alert.alert(
                t("mobile.server.providers.disconnectTitle", { name }),
                t("mobile.server.providers.disconnectBody", { provider: agentProviderName(provider) }),
                [
                  { text: t("common.cancel"), style: "cancel" },
                  {
                    text: t("mobile.server.providers.disconnect"),
                    style: "destructive",
                    onPress: () =>
                      void run("sign-out", async () => {
                        await signOut(provider);
                        await onStatusChanged();
                      }),
                  },
                ],
              )
            }
          >
            <Typography.Paragraph className="text-danger-text">
              {t("mobile.server.providers.disconnect")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
      {removable ? (
        <SettingsSection>
          <SettingsRow
            disclosure={false}
            disabled={pending !== null}
            leading={<RowIcon icon={Trash2} tone="danger" />}
            onPress={() =>
              Alert.alert(
                t("mobile.server.providers.removeAccountTitle", { name }),
                t("mobile.server.providers.removeAccountBody"),
                [
                  { text: t("common.cancel"), style: "cancel" },
                  {
                    text: t("mobile.server.providers.removeAccount"),
                    style: "destructive",
                    onPress: () => void run("remove", () => accounts.remove(provider, account.id)),
                  },
                ],
              )
            }
          >
            <Typography.Paragraph className="text-danger-text">
              {t("mobile.server.providers.removeAccount")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
    </SettingsContent>
  );
}
