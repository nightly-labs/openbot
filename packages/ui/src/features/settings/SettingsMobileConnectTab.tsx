import type { MobileConnectedDevice } from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
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
} from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import type { SettingsMobileConnectStore } from "./stores/mobile-connect-store";

interface SettingsMobileConnectTabProps {
  store: SettingsMobileConnectStore;
  canCreateTicket: boolean;
  canRevokeDevice: boolean;
}

const IOS_PLATFORM_LABEL = "iOS";
const ANDROID_PLATFORM_LABEL = "Android";

function devicePlatformLabel(platform: MobileConnectedDevice["platform"], t: AppTranslate): string {
  if (platform === "ios") return IOS_PLATFORM_LABEL;
  if (platform === "android") return ANDROID_PLATFORM_LABEL;
  return t("settings.mobileConnect.platform.mobile");
}

export function SettingsMobileConnectTab(props: SettingsMobileConnectTabProps) {
  const { t } = useText();
  return (
    <SettingsSection title={t("settings.mobileConnect.title")} description={t("settings.mobileConnect.description")}>
      <ItemGroup class="settings-modal-card settings-mobile-connect-card">
        <Item class="settings-modal-row settings-mobile-connect-action-row">
          <ItemContent>
            <ItemTitle>{t("settings.mobileConnect.signIn.title")}</ItemTitle>
            <ItemDescription>{t("settings.mobileConnect.signIn.description")}</ItemDescription>
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
              loadingLabel={t("settings.mobileConnect.generating")}
              disabled={!props.canCreateTicket}
              onClick={() => void props.store.createTicket()}
            >
              {props.store.state.connect.session
                ? t("settings.mobileConnect.generateNew")
                : t("settings.mobileConnect.generate")}
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
                          {t("settings.mobileConnect.expired.title")}
                        </Text>
                        <Text variant="caption" tone="muted">
                          {t("settings.mobileConnect.expired.description")}
                        </Text>
                      </div>
                    }
                  >
                    <div
                      class="settings-mobile-connect-qr-stage"
                      data-success={session().successDeviceName ? "" : undefined}
                    >
                      <QrCode value={session().ticket.qrData} label={t("settings.mobileConnect.qrLabel")} />
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
                              {t("settings.mobileConnect.scan.title")}
                            </Text>
                            <Text variant="caption" tone="muted">
                              {t("settings.mobileConnect.scan.description")}
                            </Text>
                            <Text class="settings-mobile-connect-expiry" variant="caption" aria-atomic="true">
                              {t("settings.mobileConnect.expiresIn", { time: props.store.expiryLabel() })}
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
                              {t("settings.mobileConnect.connected.title")}
                            </Text>
                            <Text variant="caption" tone="muted" role="status">
                              {t("settings.mobileConnect.connected.description", { name: deviceName() })}
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
          <h3 id="settings-mobile-devices-title">{t("settings.mobileConnect.devices.title")}</h3>
          <Show when={props.store.state.devices.loading}>
            <Text as="span" variant="caption" tone="muted" role="status">
              {t("settings.mobileConnect.devices.refreshing")}
            </Text>
          </Show>
        </div>
        <Alert tone="neutral">
          <AlertIcon>
            <Info />
          </AlertIcon>
          <AlertContent>
            <AlertTitle>{t("settings.mobileConnect.disconnectInfo.title")}</AlertTitle>
            <AlertDescription>{t("settings.mobileConnect.disconnectInfo.description")}</AlertDescription>
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
                    {t("settings.mobileConnect.devices.empty.title")}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {t("settings.mobileConnect.devices.empty.description")}
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
                      <th scope="col">{t("settings.mobileConnect.devices.column.device")}</th>
                      <th scope="col">{t("settings.mobileConnect.devices.column.platform")}</th>
                      <th scope="col">{t("settings.mobileConnect.devices.column.connected")}</th>
                      <th scope="col">{t("settings.mobileConnect.devices.column.lastActive")}</th>
                      <th scope="col">
                        <span class="sr-only">{t("settings.mobileConnect.devices.column.actions")}</span>
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
                          <td>{devicePlatformLabel(device.platform, t)}</td>
                          <td>{props.store.deviceTimeLabel(device.connectedAt)}</td>
                          <td>{props.store.deviceTimeLabel(device.lastActiveAt)}</td>
                          <td class="settings-mobile-device-action">
                            <Button
                              type="button"
                              variant="destructive-ghost"
                              size="xs"
                              loading={props.store.state.devices.revokingSessionId === device.sessionId}
                              loadingLabel={t("settings.disconnect.pending")}
                              disabled={!props.canRevokeDevice}
                              aria-label={t("settings.mobileConnect.devices.disconnectLabel", { name: device.name })}
                              onClick={() => void props.store.revokeDevice(device)}
                            >
                              {t("settings.disconnect.action")}
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
