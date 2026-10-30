import type { HostGitHubConnectorStatus } from "@openbot/contracts/ipc";
import type { UseQueryResult } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import { Typography } from "heroui-native";
import { Alert } from "react-native";
import { ConnectorError, ConnectorHeader } from "@/features/servers/components/connector-header";
import { TrailingValue } from "@/features/servers/components/trailing-value";
import { platformPage } from "@/features/servers/model/connectors";
import { useConnectorAction, useGitHubRepositories } from "@/features/servers/model/use-server-connectors";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import type { GitHubConnectorRoute, MobileServer } from "@/features/workspace/model/workspace-types";
import { currentText, useText } from "@/shared/lib/text";

const STATUS_KEYS = {
  disconnected: "mobile.server.connectors.statusNotSetUp",
  pending: "mobile.server.connectors.statusConnecting",
  connected: "mobile.server.connectors.statusConnected",
  expired: "mobile.server.connectors.statusExpired",
} as const;

/** Opens a GitHub page that the host named. The host opens no page of its own. */
async function openGitHub(address: string | null): Promise<void> {
  const page = platformPage("github", address);
  if (!page) throw new Error(currentText().t("mobile.server.connectors.openFailed"));
  await openBrowserAsync(page);
}

/**
 * Server settings › Connectors › GitHub of a joined server. The host runs the device flow: the phone
 * shows the code and opens GitHub's page, where the user types it. The host sees the sign-in by itself.
 */
export function GitHubConnectorPage({
  server,
  query,
}: {
  server: MobileServer;
  query: UseQueryResult<HostGitHubConnectorStatus>;
}) {
  const { t, format, errorMessage } = useText();
  const { githubConnector } = useMobileWorkspaceActions();
  const action = useConnectorAction(query.refetch);
  const status = query.data;
  const repositories = useGitHubRepositories(server.id, status?.state === "connected");
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
  const send = (route: GitHubConnectorRoute) => githubConnector(route, server.id);
  const connect = () =>
    void action.perform(async () => {
      await send("githubConnect");
    });
  const copyAndOpen = () =>
    void action.perform(async () => {
      if (status.userCode) await Clipboard.setStringAsync(status.userCode);
      await openGitHub(status.verificationUri);
    });
  const login = status.login ?? "";
  const disconnect = () =>
    Alert.alert(
      t("mobile.server.connectors.github.disconnectTitle"),
      t("mobile.server.connectors.github.disconnectBody", { login, host }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("mobile.server.connectors.disconnect"),
          style: "destructive",
          onPress: () =>
            void action.perform(async () => {
              // GitHub's revoke page opens only when a sign-in was stored, as on the desktop.
              const signedIn = status.state === "connected" || status.state === "expired";
              const next = await send("githubDisconnect");
              if (signedIn && next.revokeUrl) await openGitHub(next.revokeUrl);
            }),
        },
      ],
    );
  const failure = action.error
    ? errorMessage(
        action.error,
        t("mobile.server.connectors.actionFailed", { name: t("mobile.server.connectors.github.title") }),
      )
    : (status.error ?? (query.isError ? errorMessage(query.error, t("mobile.server.connectors.readFailed")) : null));

  return (
    <SettingsContent>
      <ConnectorHeader
        id="github"
        status={t(STATUS_KEYS[status.state])}
        attention={status.state === "expired"}
        description={t("mobile.server.connectors.github.description", { host })}
      />
      <ConnectorError message={failure} />
      {status.state === "disconnected" ? (
        <SettingsSection footer={status.available ? undefined : t("mobile.server.connectors.github.unavailable")}>
          <SettingsRow disclosure={false} disabled={action.busy || !status.available} onPress={connect}>
            <Typography.Paragraph className="text-accent">
              {t("mobile.server.connectors.github.connect")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
      {status.state === "pending" ? (
        <SettingsSection
          title={t("mobile.server.connectors.github.codeTitle")}
          footer={t("mobile.server.connectors.github.codeFooter")}
        >
          <SettingsRow disclosure={false}>
            <Typography.Heading type="h3" selectable accessibilityLabel={status.userCode ?? undefined}>
              {status.userCode ?? "…"}
            </Typography.Heading>
          </SettingsRow>
          <SettingsRow disclosure={false} disabled={action.busy || !status.userCode} onPress={copyAndOpen}>
            <Typography.Paragraph className="text-accent">
              {t("mobile.server.connectors.github.copyAndOpen")}
            </Typography.Paragraph>
          </SettingsRow>
          <SettingsRow
            disclosure={false}
            onPress={() =>
              void action.perform(async () => {
                await send("githubCancel");
              })
            }
          >
            <Typography.Paragraph className="text-accent">{t("common.cancel")}</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
      {status.state === "connected" ? (
        <>
          <SettingsSection title={t("mobile.server.connectors.github.accountTitle")}>
            <SettingsRow disclosure={false}>
              <Typography.Paragraph>{t("mobile.server.connectors.github.connectedAs", { login })}</Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
          <SettingsSection footer={t("mobile.server.connectors.github.repositoriesFooter")}>
            <SettingsRow
              trailing={
                repositories.data ? <TrailingValue value={format.number(repositories.data.total)} /> : undefined
              }
              supportingText={
                repositories.isError
                  ? errorMessage(repositories.error, t("mobile.server.connectors.github.repositoriesFailed"))
                  : repositories.data
                    ? undefined
                    : t("mobile.server.connectors.github.repositoriesLoading")
              }
              onPress={() =>
                router.push({ pathname: "/server-settings/github-repositories", params: { serverId: server.id } })
              }
            >
              <Typography.Paragraph>{t("mobile.server.connectors.github.repositoriesTitle")}</Typography.Paragraph>
            </SettingsRow>
            {status.installUrl ? (
              <SettingsRow
                disclosure={false}
                disabled={action.busy}
                onPress={() =>
                  void action.perform(async () => {
                    await openGitHub(status.installUrl);
                    // The user can change the repositories on GitHub's page, so the list is read again.
                    await repositories.refetch();
                  })
                }
              >
                <Typography.Paragraph className="text-accent">
                  {t("mobile.server.connectors.github.chooseRepositories")}
                </Typography.Paragraph>
              </SettingsRow>
            ) : null}
          </SettingsSection>
        </>
      ) : null}
      {status.state === "expired" ? (
        <SettingsSection
          title={t("mobile.server.connectors.github.expired")}
          footer={t("mobile.server.connectors.github.expiredBody", { login })}
        >
          <SettingsRow disclosure={false} disabled={action.busy || !status.available} onPress={connect}>
            <Typography.Paragraph className="text-accent">
              {t("mobile.server.connectors.reconnect")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
      {status.state === "connected" || status.state === "expired" ? (
        <SettingsSection>
          <SettingsRow disclosure={false} disabled={action.busy} onPress={disconnect}>
            <Typography.Paragraph className="text-danger-text">
              {t("mobile.server.connectors.github.disconnect")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
    </SettingsContent>
  );
}
