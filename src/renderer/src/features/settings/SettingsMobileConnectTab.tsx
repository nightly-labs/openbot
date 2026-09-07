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
  return (
    <SettingsSection
      title="Connect your phone"
      description="Scan a one-time code with the OpenBot mobile app to use this account on your phone."
    >
      <ItemGroup class="settings-modal-card settings-mobile-connect-card">
        <Item class="settings-modal-row settings-mobile-connect-action-row">
          <ItemContent>
            <ItemTitle>Mobile sign-in</ItemTitle>
            <ItemDescription>
              The code expires after two minutes and stops working after the first successful scan.
            </ItemDescription>
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
              loadingLabel="Generating…"
              disabled={!props.canCreateTicket}
              onClick={() => void props.store.createTicket()}
            >
              {props.store.state.connect.session ? "Generate new code" : "Generate QR code"}
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
                          This code has expired
                        </Text>
                        <Text variant="caption" tone="muted">
                          Generate a new code to connect your phone.
                        </Text>
                      </div>
                    }
                  >
                    <div
                      class="settings-mobile-connect-qr-stage"
                      data-success={session().successDeviceName ? "" : undefined}
                    >
                      <QrCode value={session().ticket.qrData} label="Mobile Connect sign-in QR code" />
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
                              Open OpenBot on your phone
                            </Text>
                            <Text variant="caption" tone="muted">
                              Choose Scan QR code and point your camera at this code.
                            </Text>
                            <Text class="settings-mobile-connect-expiry" variant="caption" aria-atomic="true">
                              Expires in {props.store.expiryLabel()}
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
                              Phone connected
                            </Text>
                            <Text variant="caption" tone="muted" role="status">
                              {deviceName()} is ready to use OpenBot.
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
          <h3 id="settings-mobile-devices-title">Connected devices</h3>
          <Show when={props.store.state.devices.loading}>
            <Text as="span" variant="caption" tone="muted" role="status">
              Refreshing…
            </Text>
          </Show>
        </div>
        <Alert tone="neutral">
          <AlertIcon>
            <Info />
          </AlertIcon>
          <AlertContent>
            <AlertTitle>Disconnecting a device</AlertTitle>
            <AlertDescription>
              Access is revoked immediately. The mobile app may keep showing its current screen until it is reopened or
              brought back from the background.
            </AlertDescription>
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
                    No connected devices
                  </Text>
                  <Text variant="caption" tone="muted">
                    Devices connected with Mobile Connect will appear here.
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
                      <th scope="col">Device</th>
                      <th scope="col">Platform</th>
                      <th scope="col">Connected</th>
                      <th scope="col">Last active</th>
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
                              loadingLabel="Disconnecting…"
                              disabled={!props.canRevokeDevice}
                              aria-label={`Disconnect ${device.name}`}
                              onClick={() => void props.store.revokeDevice(device)}
                            >
                              Disconnect
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
