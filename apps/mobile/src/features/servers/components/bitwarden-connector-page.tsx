import type { BitwardenConnectorStatus } from "@openbot/contracts/ipc";
import {
  BITWARDEN_CONNECTOR_KEY_LIMIT,
  BITWARDEN_CONNECTOR_PASSWORD_LIMIT,
  BITWARDEN_CONNECTOR_URL_LIMIT,
} from "@openbot/contracts/team-protocol/bitwarden-connector-v1";
import type { UseQueryResult } from "@tanstack/react-query";
import { Typography } from "heroui-native";
import { useState } from "react";
import { Alert } from "react-native";
import { ConnectorError, ConnectorHeader } from "@/features/servers/components/connector-header";
import { CONNECTOR_STATUS_KEYS } from "@/features/servers/model/connectors";
import { useConnectorAction } from "@/features/servers/model/use-server-connectors";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import type { MobileServer } from "@/features/workspace/model/workspace-types";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { useText } from "@/shared/lib/text";

/** The hosted Bitwarden service. A self-hosted Vaultwarden server replaces it in the form. */
const DEFAULT_SERVER_URL = "https://vault.bitwarden.com";

/**
 * Server settings › Connectors › Bitwarden of a joined server (`bitwarden-connector-v1`). The host
 * signs in with its own `bw` CLI, so the user enters the vault server, a personal API key and the
 * master password here. They go to the host once; this phone keeps no copy. The host answers
 * `connecting` at once, and the page reads the status again while it shows.
 */
export function BitwardenConnectorPage({
  server,
  query,
}: {
  server: MobileServer;
  query: UseQueryResult<BitwardenConnectorStatus>;
}) {
  const { t, errorMessage } = useText();
  const { connectBitwarden, disconnectBitwarden } = useMobileWorkspaceActions();
  const action = useConnectorAction(query.refetch);
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [masterPassword, setMasterPassword] = useState("");
  const status = query.data;
  const host = server.name;
  if (!status)
    return (
      <SettingsContent>
        <SettingsNote>
          {query.isError
            ? errorMessage(query.error, t("mobile.server.connectors.readFailed"))
            : t("mobile.server.connectors.loading")}
        </SettingsNote>
      </SettingsContent>
    );
  const state = status.connecting ? "connecting" : status.connected ? "connected" : "idle";
  const input = {
    serverUrl: serverUrl.trim(),
    clientId: clientId.trim(),
    clientSecret: clientSecret.trim(),
    masterPassword,
  };
  const ready = Boolean(input.serverUrl && input.clientId && input.clientSecret && input.masterPassword);
  const edit = (set: (value: string) => void) => (value: string) => {
    set(value);
    action.reset();
  };
  const connect = () => {
    // The secrets leave the form when the request starts, as on the desktop.
    setClientSecret("");
    setMasterPassword("");
    void action.perform(async () => {
      await connectBitwarden(input, server.id);
    });
  };
  const disconnect = () =>
    void action.perform(async () => {
      await disconnectBitwarden(server.id);
    });
  const confirmDisconnect = () =>
    Alert.alert(
      t("mobile.server.connectors.bitwarden.disconnectTitle"),
      t("mobile.server.connectors.bitwarden.disconnectBody", { host }),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("mobile.server.connectors.disconnect"), style: "destructive", onPress: disconnect },
      ],
    );
  const failure = action.error
    ? errorMessage(
        action.error,
        t("mobile.server.connectors.actionFailed", { name: t("mobile.server.connectors.bitwarden.title") }),
      )
    : (status.error ?? (query.isError ? errorMessage(query.error, t("mobile.server.connectors.readFailed")) : null));

  return (
    <SettingsContent>
      <ConnectorHeader
        id="bitwarden"
        status={t(CONNECTOR_STATUS_KEYS[state])}
        description={t("mobile.server.connectors.bitwarden.description", { host })}
      />
      <ConnectorError message={failure} />
      {state === "connected" ? (
        <>
          <SettingsSection
            title={t("mobile.server.connectors.bitwarden.folderTitle")}
            footer={t("mobile.server.connectors.bitwarden.folderFooter")}
          >
            <SettingsRow disclosure={false} supportingText={t("mobile.server.connectors.bitwarden.folderKind")}>
              <Typography.Paragraph>{t("mobile.server.connectors.bitwarden.folderName")}</Typography.Paragraph>
            </SettingsRow>
            {status.serverUrl ? (
              <SettingsRow disclosure={false} supportingText={status.serverUrl}>
                <Typography.Paragraph>{t("mobile.server.connectors.bitwarden.serverUrl")}</Typography.Paragraph>
              </SettingsRow>
            ) : null}
          </SettingsSection>
          <SettingsSection>
            <SettingsRow disclosure={false} disabled={action.busy} onPress={confirmDisconnect}>
              <Typography.Paragraph className="text-danger-text">
                {t("mobile.server.connectors.bitwarden.disconnect")}
              </Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
        </>
      ) : state === "connecting" ? (
        <>
          <SettingsNote>{t("mobile.server.connectors.bitwarden.connectingBody", { host })}</SettingsNote>
          <SettingsSection>
            <SettingsRow disclosure={false} disabled={action.busy} onPress={disconnect}>
              <Typography.Paragraph className="text-danger-text">{t("common.cancel")}</Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
        </>
      ) : (
        <>
          <SettingsNote>{t("mobile.server.connectors.bitwarden.howItWorks", { host })}</SettingsNote>
          <SheetFormField
            label={t("mobile.server.connectors.bitwarden.serverUrl")}
            autoCapitalize="none"
            autoCorrect={false}
            inputMode="url"
            maxLength={BITWARDEN_CONNECTOR_URL_LIMIT}
            value={serverUrl}
            editable={!action.busy}
            hint={t("mobile.server.connectors.bitwarden.serverUrlHint", { host })}
            onChangeText={edit(setServerUrl)}
          />
          <SheetFormField
            label={t("mobile.server.connectors.bitwarden.clientId")}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={BITWARDEN_CONNECTOR_KEY_LIMIT}
            value={clientId}
            editable={!action.busy}
            onChangeText={edit(setClientId)}
          />
          <SheetFormField
            label={t("mobile.server.connectors.bitwarden.clientSecret")}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            maxLength={BITWARDEN_CONNECTOR_KEY_LIMIT}
            value={clientSecret}
            editable={!action.busy}
            onChangeText={edit(setClientSecret)}
          />
          <SheetFormField
            label={t("mobile.server.connectors.bitwarden.masterPassword")}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            maxLength={BITWARDEN_CONNECTOR_PASSWORD_LIMIT}
            value={masterPassword}
            editable={!action.busy}
            hint={t("mobile.server.connectors.bitwarden.keptHint", { host })}
            onChangeText={edit(setMasterPassword)}
          />
          <SettingsSection>
            <SettingsRow disclosure={false} disabled={action.busy || !ready} onPress={connect}>
              <Typography.Paragraph className="text-accent">
                {action.busy
                  ? t("mobile.server.connectors.bitwarden.connecting")
                  : t("mobile.server.connectors.bitwarden.connect")}
              </Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
        </>
      )}
    </SettingsContent>
  );
}
