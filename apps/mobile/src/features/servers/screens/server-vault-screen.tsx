import type {
  VaultApiKeySummary,
  VaultCardSummary,
  VaultContactSummary,
  VaultHostImportResult,
  VaultLoginSummary,
} from "@openbot/contracts/ipc";
import { VAULT_IMPORT_CSV_LIMIT } from "@openbot/contracts/team-protocol/vault-import-v1";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { router, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useState } from "react";
import { useServerVault } from "@/features/servers/model/use-server-vault";
import { vaultCardTitle, vaultContactTitle, vaultLoginTitle } from "@/features/servers/model/vault-items";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { useText } from "@/shared/lib/text";

/** The file types that a password export can have. Some providers name a CSV file plain text. */
const CSV_TYPES = ["text/csv", "text/comma-separated-values", "text/plain"];

/**
 * Reads a picked CSV file and deletes this phone's copy of it at once: the file holds passwords in
 * plain text. Null when the user closed the picker.
 */
async function readPickedCsv(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: CSV_TYPES,
    multiple: false,
    copyToCacheDirectory: true,
  });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  const file = new File(asset.uri);
  try {
    return await file.text();
  } finally {
    if (file.exists) file.delete();
  }
}

/**
 * Server settings › Vault of a joined server (`vault-v1`), for an owner or admin. It lists the logins,
 * cards and contact info that the host's agents fill, and with `vault-v2` the API keys that they read,
 * adds and opens items, and imports a CSV password export. The host never sends a password, a card
 * number, a security code or an API key, so none shows here.
 */
export function ServerVaultScreen() {
  const { t, errorMessage } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const vault = useServerVault(serverId);
  const { importVaultCsv } = useMobileWorkspaceActions();
  const [importResult, setImportResult] = useState<VaultHostImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const { server, canManage, canImport, canManageApiKeys, query, action, perform } = vault;
  if (!server || !canManage)
    return (
      <SettingsContent>
        <SettingsNote>{t(server ? "mobile.server.vault.unavailable" : "mobile.server.unavailable")}</SettingsNote>
      </SettingsContent>
    );
  const host = server.name;
  const state = query.data;
  if (!state)
    return (
      <SettingsContent>
        <SettingsNote>
          {query.isError
            ? errorMessage(query.error, t("mobile.server.vault.loadFailed"))
            : t("mobile.server.vault.loading")}
        </SettingsNote>
        {query.isError ? (
          <SettingsSection>
            <SettingsRow disclosure={false} disabled={query.isFetching} onPress={() => void query.refetch()}>
              <Typography.Paragraph className="text-accent">{t("mobile.server.vault.retry")}</Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
        ) : null}
      </SettingsContent>
    );
  if (state.status !== "ready")
    return (
      <SettingsContent>
        <SettingsNote>
          {t(
            state.status === "unreadable"
              ? "mobile.server.vault.statusUnreadable"
              : "mobile.server.vault.statusUnavailable",
            { host },
          )}
        </SettingsNote>
      </SettingsContent>
    );

  const logins = state.items.filter((item): item is VaultLoginSummary => item.kind === "login");
  const cards = state.items.filter((item): item is VaultCardSummary => item.kind === "card");
  const contacts = state.items.filter((item): item is VaultContactSummary => item.kind === "contact");
  const apiKeys = state.items.filter((item): item is VaultApiKeySummary => item.kind === "apiKey");
  const open = (params: { itemId: string } | { kind: "login" | "card" | "contact" | "apiKey" }) =>
    router.push({ pathname: "/server-settings/vault-item", params: { serverId, ...params } });
  const addedBy = (name: string | undefined) => (name ? t("mobile.server.vault.addedBy", { name }) : undefined);

  const importCsv = async () => {
    setImportResult(null);
    setImportError(null);
    let csv: string | null;
    try {
      csv = await readPickedCsv();
    } catch {
      setImportError(t("mobile.server.vault.importReadFailed"));
      return;
    }
    if (csv === null) return;
    if (csv.length > VAULT_IMPORT_CSV_LIMIT) {
      setImportError(t("mobile.server.vault.importTooLarge", { host }));
      return;
    }
    const text = csv;
    await perform(async () => {
      setImportResult(await importVaultCsv(text, serverId));
      // The answer has only the counts, so the list is read again.
      await query.refetch();
    });
  };
  const importFooter = action.error
    ? errorMessage(action.error, t("mobile.server.vault.importFailed"))
    : (importError ??
      (importResult
        ? t("mobile.server.vault.importResult", { imported: importResult.imported, skipped: importResult.skipped })
        : t("mobile.server.vault.importFooter", { host })));
  const empty = (
    <SettingsRow disclosure={false}>
      <Typography.Paragraph className="text-grouped-secondary">{t("mobile.server.vault.empty")}</Typography.Paragraph>
    </SettingsRow>
  );

  return (
    <SettingsContent>
      <SettingsNote>{t("mobile.server.vault.description", { host })}</SettingsNote>
      <SettingsSection title={t("mobile.server.vault.logins")}>
        {logins.length === 0 ? empty : null}
        {logins.map((login) => (
          <SettingsRow
            key={login.id}
            supportingText={login.username || addedBy(login.addedBy)}
            onPress={() => open({ itemId: login.id })}
          >
            <Typography.Paragraph numberOfLines={1}>{vaultLoginTitle(login)}</Typography.Paragraph>
          </SettingsRow>
        ))}
        <SettingsRow disclosure={false} onPress={() => open({ kind: "login" })}>
          <Typography.Paragraph className="text-accent">{t("mobile.server.vault.addLogin")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={t("mobile.server.vault.cards")}>
        {cards.length === 0 ? empty : null}
        {cards.map((card) => (
          <SettingsRow
            key={card.id}
            supportingText={t("mobile.server.vault.cardSummary", {
              last4: card.last4,
              date: `${String(card.expMonth).padStart(2, "0")}/${card.expYear}`,
            })}
            onPress={() => open({ itemId: card.id })}
          >
            <Typography.Paragraph numberOfLines={1}>{vaultCardTitle(card, t)}</Typography.Paragraph>
          </SettingsRow>
        ))}
        <SettingsRow disclosure={false} onPress={() => open({ kind: "card" })}>
          <Typography.Paragraph className="text-accent">{t("mobile.server.vault.addCard")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={t("mobile.server.vault.contacts")}>
        {contacts.length === 0 ? empty : null}
        {contacts.map((contact) => (
          <SettingsRow
            key={contact.id}
            supportingText={contact.email || contact.phone || addedBy(contact.addedBy)}
            onPress={() => open({ itemId: contact.id })}
          >
            <Typography.Paragraph numberOfLines={1}>{vaultContactTitle(contact, t)}</Typography.Paragraph>
          </SettingsRow>
        ))}
        <SettingsRow disclosure={false} onPress={() => open({ kind: "contact" })}>
          <Typography.Paragraph className="text-accent">{t("mobile.server.vault.addContact")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      {canManageApiKeys ? (
        <SettingsSection
          title={t("mobile.server.vault.apiKeys")}
          footer={t("mobile.server.vault.apiKeysFooter", { host })}
        >
          {apiKeys.length === 0 ? empty : null}
          {apiKeys.map((apiKey) => (
            <SettingsRow
              key={apiKey.id}
              supportingText={apiKey.notes || undefined}
              onPress={() => open({ itemId: apiKey.id })}
            >
              <Typography.Paragraph numberOfLines={1}>{apiKey.name}</Typography.Paragraph>
            </SettingsRow>
          ))}
          <SettingsRow disclosure={false} onPress={() => open({ kind: "apiKey" })}>
            <Typography.Paragraph className="text-accent">{t("mobile.server.vault.addApiKey")}</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
      {/* A host with the Vault but without the import keeps its CSV import on the host. */}
      {canImport ? (
        <SettingsSection footer={importFooter}>
          <SettingsRow disclosure={false} disabled={action.isPending} onPress={() => void importCsv()}>
            <Typography.Paragraph className="text-accent">
              {action.isPending ? t("mobile.server.vault.importing") : t("mobile.server.vault.import")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
    </SettingsContent>
  );
}
