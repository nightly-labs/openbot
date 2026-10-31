import {
  type AgentProviderId,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  isAgentProvider,
  PROVIDER_ACCOUNT_LABEL_MAX_LENGTH,
  type ProviderAccountStatus,
} from "@openbot/contracts/ipc";
import { CLAUDE_API_KEY_ACCOUNT_ID } from "@openbot/contracts/team-protocol/claude-api-key-v1";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { useProviderAccountName } from "@/features/agents/components/agent-runtime-fields";
import { type ProviderAdmin, providerAccountStateKey } from "@/features/servers/model/provider-admin";
import { useProviderAdmin, useServerProviderAccounts } from "@/features/servers/model/use-server-providers";
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

/**
 * Server settings > Providers > a provider > one of its accounts on the host: its name, its sign-in
 * and its removal. A sign-in runs on the provider page, which has the relayed sign-in.
 */
export function ServerProviderAccountScreen() {
  const { t, errorMessage } = useText();
  const params = useLocalSearchParams<{ serverId: string; provider: string; accountId: string }>();
  const provider = isAgentProvider(params.provider) ? params.provider : null;
  const { available, admin } = useProviderAdmin(params.serverId);
  const accounts = useServerProviderAccounts(params.serverId, admin);
  const list = accounts.list.data?.providers.find((entry) => entry.provider === provider)?.accounts ?? [];
  const index = list.findIndex((account) => account.id === params.accountId);
  const account = list[index];
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
      onChanged={accounts.refresh}
    />
  );
}

function AccountPage({
  serverId,
  provider,
  account,
  index,
  accounts,
  onChanged,
}: {
  serverId: string;
  provider: AgentProviderId;
  account: ProviderAccountStatus;
  index: number;
  accounts: NonNullable<ProviderAdmin["accounts"]>;
  onChanged: () => Promise<void>;
}) {
  const { t, sourceText, errorMessage } = useText();
  const accountName = useProviderAccountName();
  const name = accountName(account, index);
  const [label, setLabel] = useState(account.label ?? "");
  const [pending, setPending] = useState<"rename" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  // A removed account leaves the page before the list without it shows, so the page does not say "gone".
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (!leaving) return;
    router.back();
    void onChanged();
  }, [leaving, onChanged]);

  async function run(kind: "rename" | "remove", operation: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setPending(kind);
    setError(null);
    try {
      await operation();
      void haptics.notification("success");
      if (kind === "remove") setLeaving(true);
      else await onChanged();
    } catch (cause) {
      setError(errorMessage(cause, t("mobile.server.providers.accountFailed")));
      void haptics.notification("error");
    } finally {
      locked.current = false;
      setPending(null);
    }
  }

  const trimmed = label.trim();
  const dirty = trimmed !== (account.label ?? "");
  // The host keeps the provider's own sign-in, and only the key page removes the Claude API key account.
  const removable =
    account.id !== DEFAULT_PROVIDER_ACCOUNT_ID && !(provider === "claude" && account.id === CLAUDE_API_KEY_ACCOUNT_ID);
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
            onPress={() =>
              // The provider page runs the relayed sign-in and shows its page and pasted address.
              router.dismissTo({
                pathname: "/server-settings/provider",
                params: { serverId, provider, signInAccount: account.id },
              })
            }
          >
            <Typography.Paragraph className="text-accent">
              {t("mobile.server.providers.accountSignInAgain")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
      {removable ? (
        <SettingsSection>
          <SettingsRow
            disclosure={false}
            disabled={pending !== null}
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
