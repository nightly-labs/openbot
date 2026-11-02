import type { OnePasswordConnectorStatus } from "@openbot/contracts/ipc";
import { ONEPASSWORD_CONNECTOR_TOKEN_LIMIT } from "@openbot/contracts/team-protocol/onepassword-connector-v1";
import type { UseQueryResult } from "@tanstack/react-query";
import { Typography } from "heroui-native";
import { useState } from "react";
import { Alert } from "react-native";
import { ConnectorError, ConnectorHeader } from "@/features/servers/components/connector-header";
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

const STATUS_KEYS = {
  disconnected: "mobile.server.connectors.statusNotSetUp",
  connecting: "mobile.server.connectors.statusConnecting",
  "choose-account": "mobile.server.connectors.statusConnecting",
  connected: "mobile.server.connectors.statusConnected",
} as const;

/**
 * Server settings › Connectors › 1Password of a joined server. The host connects with a service
 * account token that the user pastes here. The token goes to the host once; this phone keeps no copy.
 */
export function OnePasswordConnectorPage({
  server,
  query,
}: {
  server: MobileServer;
  query: UseQueryResult<OnePasswordConnectorStatus>;
}) {
  const { t, errorMessage } = useText();
  const { connectOnePassword, disconnectOnePassword } = useMobileWorkspaceActions();
  const action = useConnectorAction(query.refetch);
  const [token, setToken] = useState("");
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
  const trimmed = token.trim();
  const connect = () =>
    void action
      .perform(async () => {
        await connectOnePassword(trimmed, server.id);
      })
      .then((connected) => {
        if (connected) setToken("");
      });
  const disconnect = () =>
    Alert.alert(
      t("mobile.server.connectors.onePassword.disconnectTitle"),
      t("mobile.server.connectors.onePassword.disconnectBody", { host }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("mobile.server.connectors.disconnect"),
          style: "destructive",
          onPress: () =>
            void action.perform(async () => {
              await disconnectOnePassword(server.id);
            }),
        },
      ],
    );
  const failure = action.error
    ? errorMessage(
        action.error,
        t("mobile.server.connectors.actionFailed", { name: t("mobile.server.connectors.onePassword.title") }),
      )
    : (status.error ?? (query.isError ? errorMessage(query.error, t("mobile.server.connectors.readFailed")) : null));

  return (
    <SettingsContent>
      <ConnectorHeader
        id="onepassword"
        status={t(STATUS_KEYS[status.state])}
        description={t("mobile.server.connectors.onePassword.description", { host })}
      />
      <ConnectorError message={failure} />
      {status.state === "connected" ? (
        <>
          <SettingsSection
            title={t("mobile.server.connectors.onePassword.vaultTitle")}
            footer={
              status.loginCount === null
                ? t("mobile.server.connectors.onePassword.vaultFooter")
                : `${t("mobile.server.connectors.onePassword.loginCount", { count: status.loginCount })} · ${t("mobile.server.connectors.onePassword.vaultFooter")}`
            }
          >
            {status.vaultNames.map((name) => (
              <SettingsRow key={name} disclosure={false}>
                <Typography.Paragraph>{name}</Typography.Paragraph>
              </SettingsRow>
            ))}
          </SettingsSection>
          <SettingsSection>
            <SettingsRow disclosure={false} disabled={action.busy} onPress={disconnect}>
              <Typography.Paragraph className="text-danger-text">
                {t("mobile.server.connectors.onePassword.disconnect")}
              </Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
        </>
      ) : status.state === "disconnected" ? (
        <>
          <SheetFormField
            label={t("mobile.server.connectors.onePassword.token")}
            placeholder={t("mobile.server.connectors.onePassword.tokenPlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            maxLength={ONEPASSWORD_CONNECTOR_TOKEN_LIMIT}
            value={token}
            editable={!action.busy}
            hint={t("mobile.server.connectors.onePassword.howItWorks", { host })}
            onChangeText={(value) => {
              setToken(value);
              action.reset();
            }}
          />
          <SettingsSection>
            <SettingsRow disclosure={false} disabled={action.busy || trimmed.length === 0} onPress={connect}>
              <Typography.Paragraph className="text-accent">
                {action.busy
                  ? t("mobile.server.connectors.onePassword.connecting")
                  : t("mobile.server.connectors.onePassword.connect")}
              </Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
        </>
      ) : (
        <SettingsNote>{t("mobile.server.connectors.onePassword.connectingBody", { host })}</SettingsNote>
      )}
    </SettingsContent>
  );
}
