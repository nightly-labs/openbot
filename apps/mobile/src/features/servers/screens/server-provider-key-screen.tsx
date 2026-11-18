import { type AgentProviderId, agentProviderName, isAgentProvider } from "@openbot/contracts/ipc";
import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import KeyRound from "lucide-react-native/icons/key-round";
import Trash2 from "lucide-react-native/icons/trash";
import { useRef, useState } from "react";
import { Alert } from "react-native";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { PasteButton } from "@/features/servers/components/paste-button";
import { type ProviderAdmin, providerAccountsAreKeys } from "@/features/servers/model/provider-admin";
import {
  useProviderKeyState,
  useRefreshProviderAccounts,
  useServerProviders,
} from "@/features/servers/model/use-server-providers";
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

/**
 * Server settings > Providers > a provider > API key: the state of the provider's key on the host, a
 * new key, and its removal. Only the key's state comes back; the phone does not keep the key.
 *
 * For a provider whose accounts are keys (`provider-account-keys-v1`), `add: "1"` adds an account from
 * its key and `account` gives that account a new key.
 */
export function ServerProviderKeyScreen() {
  const { t, errorMessage } = useText();
  const params = useLocalSearchParams<{ serverId: string; provider: string; account?: string; add?: string }>();
  const serverId = params.serverId;
  const accountId = params.account ? params.account : params.add === "1" ? null : undefined;
  const provider = isAgentProvider(params.provider) ? params.provider : null;
  const { available, admin, rows, applyStatus } = useServerProviders(serverId);
  const row = rows.find((candidate) => candidate.id === provider);
  const keyState = useProviderKeyState(serverId, row?.apiKey ? admin : null, provider);
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const refreshAccounts = useRefreshProviderAccounts(serverId);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);

  if (accountId !== undefined) {
    const connectKey = admin?.accounts?.connectKey;
    if (!available || !provider || !connectKey || !providerAccountsAreKeys(provider))
      return (
        <SettingsContent>
          <SettingsNote>{t("mobile.server.providers.unavailable")}</SettingsNote>
        </SettingsContent>
      );
    return (
      <AccountKeyPage provider={provider} accountId={accountId} connectKey={connectKey} onChanged={refreshAccounts} />
    );
  }

  if (!available || !admin || !provider || !row?.apiKey)
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.server.providers.unavailable")}</SettingsNote>
      </SettingsContent>
    );

  const target = provider;
  const keyAdmin: ProviderAdmin = admin;
  async function change(operation: () => ReturnType<ProviderAdmin["setKey"]>) {
    if (locked.current) return;
    locked.current = true;
    setSaving(true);
    setError(null);
    try {
      await applyStatus(await operation());
      setDraft("");
      // `applyStatus` already shows the host's answer. The page closes while the key state and the
      // accounts load again.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.providerKey(queryScope, serverId, target),
        exact: true,
      });
      // The host keeps a Claude key as its own account.
      void refreshAccounts();
      void haptics.notification("success");
      router.back();
    } catch (cause) {
      setError(errorMessage(cause, t("mobile.server.providers.keyFailed")));
      void haptics.notification("error");
    } finally {
      locked.current = false;
      setSaving(false);
    }
  }

  const saved = keyState.data === "saved" || keyState.data === "unreadable";
  return (
    <SettingsContent>
      <SheetSaveAction
        dirty={draft.trim().length > 0}
        canSave
        pending={saving}
        label={t("mobile.server.providers.saveKey")}
        onSave={() => void change(() => keyAdmin.setKey(target, draft.trim()))}
      />
      <SettingsSection
        title={agentProviderName(provider)}
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
          leading={<RowIcon icon={KeyRound} />}
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
      </SettingsSection>
      {/* `apiKeyClear` does not remove the Codex login (`codex-api-key-v1`); the ChatGPT sign-in replaces it. */}
      {saved && provider !== "codex" ? (
        <SettingsSection>
          <SettingsRow
            disclosure={false}
            disabled={saving}
            leading={<RowIcon icon={Trash2} tone="danger" />}
            onPress={() =>
              Alert.alert(currentText().t("mobile.server.providers.removeKeyTitle"), undefined, [
                { text: currentText().t("common.cancel"), style: "cancel" },
                {
                  text: currentText().t("mobile.server.providers.removeKey"),
                  style: "destructive",
                  onPress: () => void change(() => keyAdmin.clearKey(target)),
                },
              ])
            }
          >
            <Typography.Paragraph className="text-danger-text">
              {t("mobile.server.providers.removeKey")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
    </SettingsContent>
  );
}

/**
 * The API key of one account of a provider whose accounts are keys, such as Cursor: a new account when
 * `accountId` is null. The host answers when the provider accepted the key, and the page then closes.
 * When the provider refuses the key, the page shows the host's reason and keeps the key for a change.
 */
function AccountKeyPage({
  provider,
  accountId,
  connectKey,
  onChanged,
}: {
  provider: AgentProviderId;
  accountId: string | null;
  connectKey: NonNullable<NonNullable<ProviderAdmin["accounts"]>["connectKey"]>;
  onChanged: () => Promise<void>;
}) {
  const { t, errorMessage } = useText();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const adding = accountId === null;
  const name = agentProviderName(provider);

  async function save() {
    if (locked.current) return;
    locked.current = true;
    setSaving(true);
    setError(null);
    try {
      await connectKey(provider, accountId, draft.trim());
      // The page under this one shows the accounts, which load again while this page closes.
      void onChanged();
      void haptics.notification("success");
      router.back();
    } catch (cause) {
      setError(
        errorMessage(
          cause,
          t(adding ? "mobile.server.providers.accountKeyAddFailed" : "mobile.server.providers.keyFailed"),
        ),
      );
      void haptics.notification("error");
    } finally {
      locked.current = false;
      setSaving(false);
    }
  }

  return (
    <SettingsContent>
      <SheetSaveAction
        dirty={draft.trim().length > 0}
        canSave
        pending={saving}
        label={t(adding ? "mobile.server.providers.addAccount" : "mobile.server.providers.saveKey")}
        pendingLabel={t("mobile.server.providers.accountKeyChecking")}
        onSave={() => void save()}
      />
      <SettingsSection
        title={name}
        footer={
          error ??
          (saving
            ? t("mobile.server.providers.accountKeyChecking")
            : t("mobile.server.providers.accountKeyHint", { provider: name }))
        }
      >
        <SheetFormField
          hideLabel
          appearance="soft"
          label={t(adding ? "mobile.server.providers.newKey" : "mobile.server.providers.replaceKey")}
          placeholder={t(
            adding ? "mobile.server.providers.keyPlaceholder" : "mobile.server.providers.replaceKeyPlaceholder",
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
      </SettingsSection>
    </SettingsContent>
  );
}
