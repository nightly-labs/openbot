import type { MobileConnectedDevice } from "@openbot/contracts/ipc";
import { For, Show } from "solid-js";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Button,
  CircleCheck,
  Info,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  QrCode,
  SettingsSection,
  Smartphone,
  Text,
} from "../../components/ui";
import { useI18n } from "../i18n/i18n-context";
import type { SettingsMobileConnectStore } from "./stores/mobile-connect-store";

interface SettingsMobileConnectTabProps {
  store: SettingsMobileConnectStore;
  canCreateTicket: boolean;
  canRevokeDevice: boolean;
}

function devicePlatformLabel(platform: MobileConnectedDevice["platform"]): "iOS" | "Android" | "Mobile" {
  if (platform === "ios") return "iOS";
  if (platform === "android") return "Android";
  return "Mobile";
}

export function SettingsMobileConnectTab(props: SettingsMobileConnectTabProps) {
  const i18n = useI18n();
  return (
    <SettingsSection
      title={i18n.t("settings.mobileConnect.title")}
      description={i18n.t("settings.mobileConnect.description")}
    >
      <ItemGroup class="settings-modal-card settings-mobile-connect-card">
        <Item class="settings-modal-row settings-mobile-connect-action-row">
          <ItemContent>
            <ItemTitle>{i18n.t("settings.mobileConnect.signIn")}</ItemTitle>
            <ItemDescription>{i18n.t("settings.mobileConnect.codeDescription")}</ItemDescription>
            <Show when={props.store.state.connect.error}>
              {(error) => (
                <ItemDescription class="settings-modal-error" role="alert">
                  {error()}
                </ItemDescription>
              )}
            </Show>
          </ItemContent>
          <ItemActions>
            <Button
              type="button"
              size="sm"
              loading={props.store.state.connect.busy}
              loadingLabel={i18n.t("settings.mobileConnect.generating")}
              disabled={!props.canCreateTicket}
              onClick={() => void props.store.createTicket()}
            >
              {props.store.state.connect.session
                ? i18n.t("settings.mobileConnect.generateNew")
                : i18n.t("settings.mobileConnect.generate")}
            </Button>
          </ItemActions>
        </Item>

        <Show when={props.store.state.connect.session}>
          {(session) => (
            <div
              class="settings-mobile-connect-code-collapse"
              data-collapsing={session().collapsing ? "" : undefined}
              aria-hidden={session().collapsing ? "true" : undefined}
            >
              <div class="settings-mobile-connect-code-collapse-body">
                <div class="settings-mobile-connect-code" aria-live="polite">
                  <Show
                    when={!props.store.expired()}
                    fallback={
                      <div class="settings-mobile-connect-expired" role="status">
                        <Smartphone aria-hidden="true" />
                        <Text class="settings-mobile-connect-code-title" variant="body">
                          {i18n.t("settings.mobileConnect.expired")}
                        </Text>
                        <Text variant="caption" tone="muted">
                          {i18n.t("settings.mobileConnect.generateNewDescription")}
                        </Text>
                      </div>
                    }
                  >
                    <div
                      class="settings-mobile-connect-qr-stage"
                      data-success={session().successDeviceName ? "" : undefined}
                    >
                      <QrCode value={session().ticket.qrData} label={i18n.t("settings.mobileConnect.qrLabel")} />
                      <Show when={session().successDeviceName}>
                        <div class="settings-mobile-connect-success-mark" aria-hidden="true">
                          <CircleCheck />
                        </div>
                      </Show>
                    </div>
                    <div class="settings-mobile-connect-code-copy">
                      <Show
                        when={session().successDeviceName}
                        fallback={
                          <>
                            <Text class="settings-mobile-connect-code-title" variant="body">
                              {i18n.t("settings.mobileConnect.openOnPhone")}
                            </Text>
                            <Text variant="caption" tone="muted">
                              {i18n.t("settings.mobileConnect.scanInstructions")}
                            </Text>
                            <Text class="settings-mobile-connect-expiry" variant="caption" aria-atomic="true">
                              {`${i18n.t("settings.mobileConnect.expiresIn")} ${props.store.expiryLabel()}`}
                            </Text>
                          </>
                        }
                      >
                        {(deviceName) => (
                          <>
                            <Text
                              class="settings-mobile-connect-code-title settings-mobile-connect-success-title"
                              variant="body"
                            >
                              {i18n.t("settings.mobileConnect.connected")}
                            </Text>
                            <Text variant="caption" tone="muted" role="status">
                              {`${deviceName()} ${i18n.t("settings.mobileConnect.ready")}`}
                            </Text>
                          </>
                        )}
                      </Show>
                    </div>
                  </Show>
                </div>
              </div>
            </div>
          )}
        </Show>
      </ItemGroup>

      <section class="settings-mobile-devices" aria-labelledby="settings-mobile-devices-title">
        <div class="settings-mobile-devices-heading">
          <h3 id="settings-mobile-devices-title">{i18n.t("settings.mobileConnect.devices")}</h3>
          <Show when={props.store.state.devices.loading}>
            <Text as="span" variant="caption" tone="muted" role="status">
              {i18n.t("settings.mobileConnect.refreshing")}
            </Text>
          </Show>
        </div>
        <Alert tone="neutral">
          <AlertIcon>
            <Info />
          </AlertIcon>
          <AlertContent>
            <AlertTitle>{i18n.t("settings.mobileConnect.disconnectingTitle")}</AlertTitle>
            <AlertDescription>{i18n.t("settings.mobileConnect.disconnectingDescription")}</AlertDescription>
          </AlertContent>
        </Alert>
        <div class="settings-mobile-devices-states">
          <div
            class="settings-mobile-devices-state"
            data-expanded={props.store.state.devices.devices.length === 0 ? "" : undefined}
            aria-hidden={props.store.state.devices.devices.length > 0 ? "true" : undefined}
          >
            <div class="settings-mobile-devices-state-body">
              <div class="settings-mobile-devices-empty" role="status">
                <Smartphone aria-hidden="true" />
                <div>
                  <Text class="settings-mobile-devices-empty-title" variant="body">
                    {i18n.t("settings.mobileConnect.noDevices")}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {i18n.t("settings.mobileConnect.noDevicesDescription")}
                  </Text>
                </div>
              </div>
            </div>
          </div>
          <div
            class="settings-mobile-devices-state"
            data-expanded={props.store.state.devices.devices.length > 0 ? "" : undefined}
            aria-hidden={props.store.state.devices.devices.length === 0 ? "true" : undefined}
          >
            <div class="settings-mobile-devices-state-body">
              <div class="settings-mobile-devices-table-frame">
                <table class="settings-mobile-devices-table">
                  <thead>
                    <tr>
                      <th scope="col">{i18n.t("settings.mobileConnect.device")}</th>
                      <th scope="col">{i18n.t("settings.mobileConnect.platform")}</th>
                      <th scope="col">{i18n.t("settings.mobileConnect.connectedAt")}</th>
                      <th scope="col">{i18n.t("settings.mobileConnect.lastActive")}</th>
                      <th scope="col">
                        <span class="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={props.store.state.devices.devices}>
                      {(device) => (
                        <tr>
                          <td>
                            <span class="settings-mobile-device-name">
                              <Smartphone aria-hidden="true" />
                              {device.name}
                            </span>
                          </td>
                          <td>{devicePlatformLabel(device.platform)}</td>
                          <td>{props.store.deviceTimeLabel(device.connectedAt)}</td>
                          <td>{props.store.deviceTimeLabel(device.lastActiveAt)}</td>
                          <td class="settings-mobile-device-action">
                            <Button
                              type="button"
                              variant="destructive-ghost"
                              size="xs"
                              loading={props.store.state.devices.revokingSessionId === device.sessionId}
                              loadingLabel={i18n.t("settings.mobileConnect.disconnecting")}
                              disabled={!props.canRevokeDevice}
                              aria-label={`${i18n.t("settings.mobileConnect.disconnect")} ${device.name}`}
                              onClick={() => void props.store.revokeDevice(device)}
                            >
                              {i18n.t("settings.mobileConnect.disconnectAction")}
                            </Button>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
        <Show when={props.store.state.devices.error}>
          {(error) => (
            <Text class="settings-modal-error" variant="caption" role="alert">
              {error()}
            </Text>
          )}
        </Show>
      </section>
    </SettingsSection>
  );
}
