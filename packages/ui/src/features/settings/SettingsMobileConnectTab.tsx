import { PlatformLogo } from "@openbot/brand";
import type { MobileConnectedDevice } from "@openbot/contracts/ipc";
import {
  Button,
  buttonVariants,
  ChevronDown,
  ConfirmDialog,
  DropdownMenu,
  Ellipsis,
  Globe2,
  Link2,
  Lock,
  Plus,
  Popover,
  RotateCcw,
  Scan,
  SettingsSection,
  Smartphone,
  Text,
  Trash2,
} from "@openbot/ui";
import { createSignal, For, Show } from "solid-js";
import { useText } from "../../text";
import { MobileConnectAddPhoneDialog, MobileConnectLinkDialog } from "./MobileConnectDialogs";
import { RemoteNetworkRouteChoice } from "./RemoteNetworkRouteChoice";
import type { SettingsMobileConnectStore } from "./stores/mobile-connect-store";

interface SettingsMobileConnectTabProps {
  store: SettingsMobileConnectStore;
  canCreateTicket: boolean;
  canCancelTicket: boolean;
  canManageLink: boolean;
  canRevokeDevice: boolean;
  canSetRoute: boolean;
}

const IOS_PLATFORM_LABEL = "iOS";
const ANDROID_PLATFORM_LABEL = "Android";

/**
 * The phones that use this account, as cards. "Add phone" opens a dialog that shows one code at a
 * time, so a phone camera cannot catch the wrong code. The permanent link is one more card, and how
 * devices connect is a chip in the header.
 */
export function SettingsMobileConnectTab(props: SettingsMobileConnectTabProps) {
  const { t } = useText();
  const [adding, setAdding] = createSignal(false);
  const [linkOpen, setLinkOpen] = createSignal(false);
  const devices = () => props.store.state.devices.devices;
  const addButton = () => (
    <Button
      type="button"
      size="sm"
      data-settings-row="settings.mobileConnect.phones.add"
      disabled={!props.canCreateTicket}
      onClick={() => setAdding(true)}
    >
      <Plus aria-hidden="true" />
      {t("settings.mobileConnect.phones.add")}
    </Button>
  );
  return (
    <SettingsSection
      title={t("settings.mobileConnect.phones.title")}
      description={t("settings.mobileConnect.phones.description")}
      actions={
        <>
          <Show when={props.store.state.devices.loading}>
            <Text as="span" variant="caption" tone="muted" role="status">
              {t("settings.mobileConnect.devices.refreshing")}
            </Text>
          </Show>
          <RouteChip store={props.store} disabled={!props.canSetRoute} />
          <Show when={devices().length > 0}>{addButton()}</Show>
        </>
      }
    >
      <Show when={props.store.state.route.error}>
        {(error) => (
          <Text class="settings-modal-error" variant="caption" role="alert">
            {error()}
          </Text>
        )}
      </Show>
      <div class="settings-mobile-phones" data-settings-row="settings.mobileConnect.phones.title">
        <Show when={devices().length === 0}>
          <div class="settings-mobile-phones-empty">
            <span class="settings-mobile-phones-empty-icon" aria-hidden="true">
              <Smartphone />
            </span>
            <Text variant="body" class="settings-mobile-phones-empty-title">
              {t("settings.mobileConnect.phones.empty.title")}
            </Text>
            <Text variant="caption" tone="muted">
              {t("settings.mobileConnect.phones.empty.description")}
            </Text>
            {addButton()}
          </div>
        </Show>
        <For each={devices()}>
          {(device) => <PhoneCard store={props.store} device={device} canRevoke={props.canRevokeDevice} />}
        </For>
        <Show when={props.canManageLink}>
          <LinkCard store={props.store} onOpen={() => setLinkOpen(true)} />
        </Show>
      </div>
      <Show when={props.store.state.devices.error}>
        {(error) => (
          <Text class="settings-modal-error" variant="caption" role="alert">
            {error()}
          </Text>
        )}
      </Show>
      <Show when={devices().length > 0}>
        <Text variant="caption" tone="muted">
          {t("settings.mobileConnect.disconnectInfo.description")}
        </Text>
      </Show>

      <MobileConnectAddPhoneDialog
        open={adding()}
        store={props.store}
        canCancelTicket={props.canCancelTicket}
        onClose={() => setAdding(false)}
      />
      <Show when={props.canManageLink}>
        <MobileConnectLinkDialog open={linkOpen()} store={props.store} onClose={() => setLinkOpen(false)} />
        <ConfirmDialog
          open={props.store.state.link.confirm === "replace"}
          onCancel={() => props.store.setLinkConfirm(null)}
          onConfirm={async () => {
            await props.store.createLink();
            // The new link is shown, so its code opens at once.
            if (props.store.state.link.revealed) setLinkOpen(true);
          }}
          tone="default"
          title={t("settings.mobileConnect.link.replaceConfirm.title")}
          description={t("settings.mobileConnect.link.confirm.description")}
          confirmLabel={t("settings.mobileConnect.link.replace")}
        />
        <ConfirmDialog
          open={props.store.state.link.confirm === "revoke"}
          onCancel={() => props.store.setLinkConfirm(null)}
          onConfirm={() => props.store.revokeLink()}
          title={t("settings.mobileConnect.link.revokeConfirm.title")}
          description={t("settings.mobileConnect.link.revokeConfirm.description")}
          confirmLabel={t("settings.mobileConnect.link.revoke")}
        />
      </Show>
    </SettingsSection>
  );
}

function PhoneCard(props: { store: SettingsMobileConnectStore; device: MobileConnectedDevice; canRevoke: boolean }) {
  const { t } = useText();
  const platformLabel = () => {
    if (props.device.platform === "ios") return IOS_PLATFORM_LABEL;
    if (props.device.platform === "android") return ANDROID_PLATFORM_LABEL;
    return t("settings.mobileConnect.platform.mobile");
  };
  return (
    <div class="settings-mobile-phone-card">
      <span class="settings-mobile-phone-icon">
        <Show
          when={props.device.platform !== "unknown" && props.device.platform}
          fallback={<Smartphone aria-hidden="true" />}
        >
          {(platform) => <PlatformLogo platform={platform()} />}
        </Show>
      </span>
      <div class="settings-mobile-phone-copy">
        <Text variant="body-sm" class="settings-mobile-phone-name">
          {props.device.name}
        </Text>
        <Text variant="caption" tone="muted">
          {platformLabel()} ·{" "}
          {t("settings.mobileConnect.devices.lastActive", {
            time: props.store.deviceTimeLabel(props.device.lastActiveAt),
          })}
        </Text>
        <span class="settings-mobile-phone-via">
          <Show when={props.device.via === "link"} fallback={<Scan aria-hidden="true" />}>
            <Link2 aria-hidden="true" />
          </Show>
          {props.device.via === "link"
            ? t("settings.mobileConnect.devices.via.link")
            : t("settings.mobileConnect.devices.via.code")}
        </span>
      </div>
      <Button
        type="button"
        variant="destructive-ghost"
        size="xs"
        loading={props.store.state.devices.revokingSessionId === props.device.sessionId}
        loadingLabel={t("settings.disconnect.pending")}
        disabled={!props.canRevoke}
        data-cuelume-tap="close"
        data-cuelume-emphasis="strong"
        aria-label={t("settings.mobileConnect.devices.disconnectLabel", { name: props.device.name })}
        onClick={() => void props.store.revokeDevice(props.device)}
      >
        {t("settings.disconnect.action")}
      </Button>
    </div>
  );
}

/** The permanent link among the phones: a dashed card that makes one, or the link with its menu. */
function LinkCard(props: { store: SettingsMobileConnectStore; onOpen: () => void }) {
  const { t, format } = useText();
  const link = () => props.store.state.link;
  const phones = () => props.store.state.devices.devices.filter((device) => device.via === "link").length;
  return (
    <div class="settings-mobile-link-card-slot" data-settings-row="settings.mobileConnect.link.title">
      <Show
        when={link().link}
        fallback={
          <Button
            type="button"
            variant="ghost"
            class="settings-mobile-phone-card settings-mobile-link-card"
            data-empty=""
            disabled={!link().loaded}
            onClick={() => props.onOpen()}
          >
            <span class="settings-mobile-phone-icon">
              <Plus aria-hidden="true" />
            </span>
            <span class="settings-mobile-phone-copy">
              <span class="settings-mobile-phone-name">{t("settings.mobileConnect.link.title")}</span>
              <span class="settings-mobile-link-card-hint">{t("settings.mobileConnect.link.cardHint")}</span>
            </span>
          </Button>
        }
      >
        {(current) => (
          <div class="settings-mobile-phone-card settings-mobile-link-card">
            <span class="settings-mobile-phone-icon" data-active="">
              <Link2 aria-hidden="true" />
            </span>
            <div class="settings-mobile-phone-copy">
              <Text variant="body-sm" class="settings-mobile-phone-name">
                {t("settings.mobileConnect.link.title")}
              </Text>
              <Text variant="caption" tone="muted">
                {phones() === 0
                  ? t("settings.mobileConnect.link.unused")
                  : t("settings.mobileConnect.link.usedBy", { count: phones() })}
              </Text>
              <Text variant="caption" tone="muted">
                {t("settings.mobileConnect.link.created", {
                  date: format.date(current().createdAt, { dateStyle: "medium" }),
                })}
              </Text>
            </div>
            <div class="settings-mobile-link-card-actions">
              <Button type="button" size="xs" variant="outline" onClick={() => props.onOpen()}>
                {t("settings.mobileConnect.link.showCode")}
              </Button>
              <DropdownMenu.Root placement="bottom-end" gutter={4}>
                <DropdownMenu.Trigger
                  class={buttonVariants({ variant: "ghost", size: "icon-sm" })}
                  aria-label={t("settings.mobileConnect.link.actions")}
                  disabled={link().busy !== null}
                >
                  <Ellipsis aria-hidden="true" />
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content>
                    <DropdownMenu.Item onSelect={() => props.store.setLinkConfirm("replace")}>
                      <RotateCcw aria-hidden="true" />
                      {t("settings.mobileConnect.link.replace")}
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item
                      class="ui-action-menu-danger"
                      onSelect={() => props.store.setLinkConfirm("revoke")}
                    >
                      <Trash2 aria-hidden="true" />
                      {t("settings.mobileConnect.link.revokeLink")}
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          </div>
        )}
      </Show>
      <Show when={link().error}>
        {(error) => (
          <Text class="settings-modal-error" variant="caption" role="alert">
            {error()}
          </Text>
        )}
      </Show>
    </div>
  );
}

/** How devices connect: the current route as a chip, and both routes in a popover. */
function RouteChip(props: { store: SettingsMobileConnectStore; disabled: boolean }) {
  const { t } = useText();
  return (
    <Show when={props.store.state.route.current}>
      {(current) => {
        const title = () =>
          current().route === "private"
            ? t("settings.mobileConnect.route.private.title")
            : t("settings.mobileConnect.route.openbot.title");
        return (
          <Popover.Root placement="bottom-end" gutter={6}>
            <Popover.Trigger
              class={`${buttonVariants({ variant: "ghost", size: "sm" })} settings-mobile-route-chip`}
              aria-label={t("settings.mobileConnect.route.chipLabel", { route: title() })}
              data-settings-row="settings.mobileConnect.route.title"
            >
              <Show when={current().route === "private"} fallback={<Globe2 aria-hidden="true" />}>
                <Lock aria-hidden="true" />
              </Show>
              {title()}
              <ChevronDown aria-hidden="true" />
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content class="ui-popover-menu-surface settings-mobile-route-popover">
                <Popover.Title class="settings-mobile-route-popover-title">
                  {t("settings.mobileConnect.route.title")}
                </Popover.Title>
                <Popover.Description class="settings-mobile-route-popover-description">
                  {t("settings.mobileConnect.route.description")}
                </Popover.Description>
                <RemoteNetworkRouteChoice
                  value={current().route}
                  tailscaleConnected={current().tailscaleConnected}
                  disabled={props.disabled || props.store.state.route.busy}
                  onChange={(route) => void props.store.setRoute(route)}
                />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        );
      }}
    </Show>
  );
}
