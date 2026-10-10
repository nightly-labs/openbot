import { AppLogo, type MobilePlatformLogoVariant, PlatformLogo } from "@openbot/brand";
import type { MobileConnectedDevice } from "@openbot/contracts/ipc";
import type { AppTextKey, AppTranslate } from "@openbot/i18n";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Badge,
  Button,
  CircleCheck,
  CopyButton,
  Info,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Link2,
  QrCode,
  SettingsSection,
  SlidingTabs,
  Smartphone,
  Text,
} from "@openbot/ui";
import { createSignal, For, Show } from "solid-js";
import { useText } from "../../text";
import { ANDROID_PLAY_STORE_URL } from "../mobile-app/android-play-store";
import { IOS_TESTFLIGHT_URL } from "../mobile-app/ios-testflight";
import type { SettingsMobileConnectStore } from "./stores/mobile-connect-store";

interface SettingsMobileConnectTabProps {
  store: SettingsMobileConnectStore;
  canCreateTicket: boolean;
  canRevokeDevice: boolean;
}

const IOS_PLATFORM_LABEL = "iOS";
const IPHONE_LABEL = "iPhone";
const ANDROID_PLATFORM_LABEL = "Android";

interface MobileAppGuide {
  platform: MobilePlatformLogoVariant;
  tab: string;
  url: string;
  title: AppTextKey;
  badge: AppTextKey;
  description: AppTextKey;
  qrLabel: AppTextKey;
  steps: readonly AppTextKey[];
}

/** The phone apps in the order of the download pages. The QR code opens the store page on the phone. */
const MOBILE_APPS: readonly MobileAppGuide[] = [
  {
    platform: "ios",
    tab: IPHONE_LABEL,
    url: IOS_TESTFLIGHT_URL,
    title: "settings.mobileConnect.iosApp.title",
    badge: "settings.mobileConnect.iosApp.badge",
    description: "settings.mobileConnect.iosApp.description",
    qrLabel: "settings.mobileConnect.iosApp.qrLabel",
    steps: [
      "settings.mobileConnect.iosApp.step.testFlight",
      "settings.mobileConnect.iosApp.step.invite",
      "settings.mobileConnect.iosApp.step.install",
    ],
  },
  {
    platform: "android",
    tab: ANDROID_PLATFORM_LABEL,
    url: ANDROID_PLAY_STORE_URL,
    title: "settings.mobileConnect.androidApp.title",
    badge: "settings.mobileConnect.androidApp.badge",
    description: "settings.mobileConnect.androidApp.description",
    qrLabel: "settings.mobileConnect.androidApp.qrLabel",
    steps: ["settings.mobileConnect.androidApp.step.scan", "settings.mobileConnect.androidApp.step.install"],
  },
];

function deviceLogo(platform: MobileConnectedDevice["platform"]): MobilePlatformLogoVariant | undefined {
  return platform === "unknown" ? undefined : platform;
}

function devicePlatformLabel(platform: MobileConnectedDevice["platform"], t: AppTranslate): string {
  if (platform === "ios") return IOS_PLATFORM_LABEL;
  if (platform === "android") return ANDROID_PLATFORM_LABEL;
  return t("settings.mobileConnect.platform.mobile");
}

export function SettingsMobileConnectTab(props: SettingsMobileConnectTabProps) {
  const { t } = useText();
  const [platform, setPlatform] = createSignal<MobilePlatformLogoVariant>("ios");
  return (
    <SettingsSection title={t("settings.mobileConnect.title")} description={t("settings.mobileConnect.description")}>
      {/* Always here, so the install steps stay available after the sidebar announcement is closed. */}
      <ItemGroup class="settings-modal-card settings-mobile-connect-card">
        <SlidingTabs.Root
          class="settings-mobile-app-install"
          value={platform()}
          onChange={(value) => {
            if (value === "ios" || value === "android") setPlatform(value);
          }}
        >
          <Item class="settings-modal-row settings-mobile-connect-action-row">
            <ItemMedia class="settings-mobile-connect-step" aria-hidden="true">
              1
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{t("settings.mobileConnect.install.title")}</ItemTitle>
              <ItemDescription>{t("settings.mobileConnect.install.description")}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <SlidingTabs.List aria-label={t("settings.mobileConnect.install.platformLabel")}>
                <For each={MOBILE_APPS}>
                  {(app) => (
                    <SlidingTabs.Trigger class="settings-mobile-app-tab" value={app.platform}>
                      <PlatformLogo platform={app.platform} />
                      {app.tab}
                    </SlidingTabs.Trigger>
                  )}
                </For>
              </SlidingTabs.List>
            </ItemActions>
          </Item>
          <SlidingTabs.ContentSlot class="settings-mobile-app-panels">
            <For each={MOBILE_APPS}>
              {(app) => (
                <SlidingTabs.Content class="settings-mobile-app-panel" value={app.platform}>
                  <QrCode class="settings-mobile-app-qr" value={app.url} size={132} label={t(app.qrLabel)}>
                    <PlatformLogo platform={app.platform} class="settings-mobile-app-qr-platform" />
                    <Link2 class="settings-mobile-app-qr-link" />
                    <AppLogo variant="production" class="settings-mobile-app-qr-logo" />
                  </QrCode>
                  <div class="settings-mobile-app-details">
                    <div class="settings-mobile-app-heading">
                      <Text class="settings-mobile-app-title" variant="body">
                        {t(app.title)}
                      </Text>
                      <Badge variant={app.platform === "ios" ? "info-light" : "success-light"}>{t(app.badge)}</Badge>
                    </div>
                    <Text variant="caption" tone="muted">
                      {t(app.description)}
                    </Text>
                    <ol class="settings-mobile-app-steps">
                      <For each={app.steps}>{(step) => <li>{t(step)}</li>}</For>
                    </ol>
                    <CopyButton
                      class="settings-mobile-app-copy"
                      variant="outline"
                      size="sm"
                      value={app.url}
                      label={t("settings.mobileConnect.app.copyLink")}
                      copiedLabel={t("settings.mobileConnect.app.linkCopied")}
                    />
                  </div>
                </SlidingTabs.Content>
              )}
            </For>
          </SlidingTabs.ContentSlot>
        </SlidingTabs.Root>
      </ItemGroup>

      <ItemGroup class="settings-modal-card settings-mobile-connect-card">
        <Item class="settings-modal-row settings-mobile-connect-action-row">
          <ItemMedia class="settings-mobile-connect-step" aria-hidden="true">
            2
          </ItemMedia>
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
                            {/* Devices without a camera, such as e-ink readers, paste this link instead. */}
                            <CopyButton
                              variant="outline"
                              size="sm"
                              value={session().ticket.qrData}
                              label={t("settings.mobileConnect.copyConnectLink")}
                              copiedLabel={t("settings.mobileConnect.connectLinkCopied")}
                            />
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
            <div class="settings-mobile-devices-state-body settings-mobile-devices-list">
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
                          <td>
                            <span class="settings-mobile-device-platform">
                              <Show when={deviceLogo(device.platform)} fallback={<Smartphone aria-hidden="true" />}>
                                {(platform) => <PlatformLogo platform={platform()} />}
                              </Show>
                              {devicePlatformLabel(device.platform, t)}
                            </span>
                          </td>
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
                              data-cuelume-tap="close"
                              data-cuelume-emphasis="strong"
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
              {/* Only beside a device that can be disconnected. */}
              <Alert tone="neutral">
                <AlertIcon>
                  <Info />
                </AlertIcon>
                <AlertContent>
                  <AlertTitle>{t("settings.mobileConnect.disconnectInfo.title")}</AlertTitle>
                  <AlertDescription>{t("settings.mobileConnect.disconnectInfo.description")}</AlertDescription>
                </AlertContent>
              </Alert>
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
