import type { HostStatus, ServerConnectionIssueCode, ServerSummary } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Badge,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Monitor,
  SettingsSection,
  Text,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { Show } from "solid-js";
import { RemoteDesktopSetup } from "./RemoteDesktopSetup";
import { serverSupportsCapability } from "./server-capabilities";

const ISSUE_TITLES = {
  client_update_required: "server.desktop.clientUpdateRequired",
  host_update_required: "server.desktop.hostUpdateRequired",
  protocol_error: "server.desktop.connectionUnavailable",
  authentication_required: "server.desktop.connectionUnavailable",
  network_unavailable: "server.desktop.connectionUnavailable",
} as const satisfies Record<ServerConnectionIssueCode, AppTextKey>;
const REMOTE_HOST_GATEWAY_NAME = "OpenBot Remote Host Gateway";

/** The Remote desktop section of the server settings dialog. */
export function ServerDesktopPanel(props: {
  server: ServerSummary;
  platform: "darwin" | "win32" | "linux";
  hostStatus: HostStatus | null | undefined;
}) {
  const { t, sourceText } = useText();

  function remoteDesktopConnection() {
    const status = () => {
      const server = props.server;
      if (server.issue) {
        return {
          title: t(ISSUE_TITLES[server.issue.code]),
          message: sourceText(server.issue.message),
          available: false,
        };
      }
      if (server.state !== "online") {
        return {
          title: t("server.desktop.hostOffline"),
          message: t("server.desktop.hostOfflineDescription"),
          available: false,
        };
      }
      if (!serverSupportsCapability(server, "remote-desktop")) {
        return {
          title: t("server.desktop.hostUpdateRequired"),
          message: t("server.desktop.hostUpdateDescription"),
          available: false,
        };
      }
      return server.remoteDesktopAvailable
        ? {
            title: t("server.desktop.serviceAvailable"),
            message: t("server.desktop.serviceAvailableDescription"),
            available: true,
          }
        : {
            title: t("server.desktop.serviceNotReady"),
            message: t("server.desktop.serviceNotReadyDescription"),
            available: false,
          };
    };
    return (
      <Item size="spacious">
        <ItemMedia class="server-settings-desktop-icon">
          <Monitor />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{t("server.desktop.remoteControl")}</ItemTitle>
          <ItemDescription class="server-settings-desktop-description">{status().message}</ItemDescription>
          <Badge
            class="server-settings-desktop-status"
            variant={status().available ? "success-light" : "warning-light"}
            shape="pill"
          >
            {status().title}
          </Badge>
        </ItemContent>
        <ItemActions class="server-settings-desktop-hint">
          <Text as="span" variant="caption" tone="muted">
            {t("server.desktop.startHint")}
          </Text>
        </ItemActions>
      </Item>
    );
  }

  return (
    <SettingsSection title={t("server.desktop.accessTitle")}>
      <RemoteDesktopSetup server={props.server} platform={props.platform} />
      <ItemGroup class="settings-modal-card server-settings-desktop-card">
        <Show when={props.server.kind === "local"} fallback={remoteDesktopConnection()}>
          <Item size="spacious">
            <ItemMedia class="server-settings-desktop-icon">
              <Monitor />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{REMOTE_HOST_GATEWAY_NAME}</ItemTitle>
              <ItemDescription class="server-settings-desktop-description">
                {t("server.desktop.gatewayDescription")}
              </ItemDescription>
            </ItemContent>
            <ItemActions class="server-settings-desktop-meta">
              <Badge variant={props.hostStatus?.remoteDesktopReady ? "success-light" : "warning-light"} shape="pill">
                {props.hostStatus?.remoteDesktopReady
                  ? t("server.desktop.componentInstalled")
                  : t("server.desktop.componentNotInstalled")}
              </Badge>
              <Text as="span" variant="caption" tone="muted">
                {t("server.desktop.sessions", {
                  unattended: props.hostStatus?.remoteDesktopUnattended
                    ? t("server.desktop.unattendedEnabled")
                    : t("server.desktop.unattendedUnavailable"),
                  active: props.hostStatus?.remoteDesktopActiveSessions ?? 0,
                  max: props.hostStatus?.remoteDesktopMaxSessions ?? 4,
                })}
              </Text>
            </ItemActions>
          </Item>
        </Show>
      </ItemGroup>
    </SettingsSection>
  );
}
