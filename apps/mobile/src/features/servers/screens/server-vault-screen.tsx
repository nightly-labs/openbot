import type {
  VaultApiKeySummary,
  VaultCardSummary,
  VaultContactSummary,
  VaultHostImportResult,
  VaultItemSummary,
  VaultLoginSummary,
} from "@openbot/contracts/ipc";
import { VAULT_IMPORT_CSV_LIMIT } from "@openbot/contracts/team-protocol/vault-import-v1";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { router, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useMemo, useState } from "react";
import { TwoStepRowCode, useCopyTwoStepCode } from "@/features/servers/components/vault-two-step-code";
import { useServerVault } from "@/features/servers/model/use-server-vault";
import {
  vaultAgentsSummary,
  vaultCardTitle,
  vaultContactTitle,
  vaultLoginTitle,
} from "@/features/servers/model/vault-items";
import { useSecondClock, useServerVaultCodes } from "@/features/servers/model/vault-two-step";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { useText } from "@/shared/lib/text";

const CSV_TYPES = ["text/csv", "text/comma-separated-values", "text/plain"];

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

export function ServerVaultScreen() {
  const { t, errorMessage } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const vault = useServerVault(serverId);
  const allAgents = useMobileWorkspaceSelector((workspace) => workspace.agents);
  const agents = useMemo(() => allAgents.filter((agent) => agent.serverId === serverId), [allAgents, serverId]);
  const { importVaultCsv } = useMobileWorkspaceActions();
  const [importResult, setImportResult] = useState<VaultHostImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const { server, canManage, canImport, canManageApiKeys, query, action, perform } = vault;
  const hasKeys = query.data?.items.some((item) => item.kind === "login" && item.hasTwoStep) ?? false;
  const codes = useServerVaultCodes(serverId, hasKeys);
  const now = useSecondClock(codes.query.data !== undefined && codes.query.data.size > 0);
  const { copy: copyCode } = useCopyTwoStepCode();
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
  const detail = (item: VaultItemSummary, text: string | undefined) =>
    [text, item.agents && t("mobile.server.vault.agentsListed", { agents: vaultAgentsSummary(item.agents, agents, t) })]
      .filter(Boolean)
      .join(" · ") || undefined;

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
        {logins.map((login) => {
          const code = codes.code(login.id);
          const site = vaultLoginTitle(login);
          return (
            <SettingsRow
              key={login.id}
              supportingText={detail(login, login.username || addedBy(login.addedBy))}
              onPress={() => open({ itemId: login.id })}
              trailing={code ? <TwoStepRowCode code={code} now={now} site={site} /> : undefined}
              disclosure={!code}
              accessibilityActions={
                code ? [{ name: "copyCode", label: t("mobile.server.vault.twoStep.copy") }] : undefined
              }
              onAccessibilityAction={(event) => {
                if (code && event.nativeEvent.actionName === "copyCode") void copyCode(code.code);
              }}
            >
              <Typography.Paragraph numberOfLines={1}>{site}</Typography.Paragraph>
            </SettingsRow>
          );
        })}
        <SettingsRow disclosure={false} onPress={() => open({ kind: "login" })}>
          <Typography.Paragraph className="text-accent">{t("mobile.server.vault.addLogin")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={t("mobile.server.vault.cards")}>
        {cards.length === 0 ? empty : null}
        {cards.map((card) => (
          <SettingsRow
            key={card.id}
            supportingText={detail(
              card,
              t("mobile.server.vault.cardSummary", {
                last4: card.last4,
                date: `${String(card.expMonth).padStart(2, "0")}/${card.expYear}`,
              }),
            )}
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
            supportingText={detail(contact, contact.email || contact.phone || addedBy(contact.addedBy))}
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
              supportingText={detail(apiKey, apiKey.notes || undefined)}
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
