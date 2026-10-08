import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AvatarImageInput, ServerNotificationLevel } from "@openbot/contracts/ipc";
import { SERVER_NOTIFICATION_LEVELS } from "@openbot/contracts/ipc";
import {
  Badge,
  Button,
  CopyButton,
  Image,
  ImageRemoveButton,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsSection,
  SwitchField,
  Text,
} from "@openbot/ui";
import { avatarImageDataUrl, normalizeAvatarFile } from "@openbot/ui/avatar-image";
import { LeaveServerDialog } from "@openbot/ui/features/servers/LeaveServerDialog";
import {
  SERVER_NOTIFICATION_LEVEL_LABELS,
  serverMuteDescription,
} from "@openbot/ui/features/servers/ServerActionItems";
import { ServerLogo } from "@openbot/ui/features/servers/ServerLogo";
import { useText } from "@openbot/ui/text";
import { truncateMiddle } from "@openbot/ui/utils";
import type { JSX } from "@solidjs/web";
import { type Accessor, createStore, Show, snapshot } from "solid-js";
import { serverCanAdminister } from "./server-capabilities";
import type { ServerSettingsSectionHost } from "./server-settings-section";

/**
 * The identity form: the name and logo as the server last confirmed them, the draft the user is
 * editing, and the validation feedback that belongs to that draft. `logo` is `undefined` while the
 * saved image stands, `null` once the user removes it, and an image once one is chosen, so it
 * carries the difference between "unchanged" and "cleared" that a save has to send.
 */
interface ServerIdentityDraft {
  editing: boolean;
  logo: AvatarImageInput | null | undefined;
  logoError: string | null;
  logoUrl: string | null;
  name: string;
  nameShaking: boolean;
  nameTouched: boolean;
  savedLogoUrl: string | null;
  savedName: string;
}

/**
 * The General section's state. Each group's fields are written together - a reset rewrites the
 * whole identity draft at once - so they are one store rather than a signal each, and replacing one
 * field re-renders only what read that field.
 */
interface GeneralPanels {
  offerRemoteDesktopSetup: boolean;
  confirmLeave: boolean;
  identity: ServerIdentityDraft;
}

interface ServerGeneralSection {
  Panel: () => JSX.Element;
  LeaveDialog: () => JSX.Element;
  /** True while the user edits the identity, so the server's own name and logo do not replace the draft. */
  editing: Accessor<boolean>;
  identityDirty: Accessor<boolean>;
  resetIdentity(): void;
  saveIdentity(): Promise<void>;
  /** Shows the name and logo the server holds now, while the user does not edit them. */
  syncFromServer(name: string, logoUrl: string | null): void;
  /** Forgets the draft state of the previous server when the dialog shows another one. */
  resetForServer(): void;
}

/** The General section: server identity, access, notifications, and leaving a joined server. */
export function createServerGeneralSection(
  host: ServerSettingsSectionHost,
  options: { onSetUpDesktop: () => void },
): ServerGeneralSection {
  const { t, format, errorMessage } = useText();
  const { props, local, configured, published, actionsAvailable, busy, run } = host;
  const [panels, setPanels] = createStore<GeneralPanels>({
    offerRemoteDesktopSetup: false,
    confirmLeave: false,
    identity: {
      editing: false,
      logo: undefined,
      logoError: null,
      logoUrl: null,
      name: "",
      nameShaking: false,
      nameTouched: false,
      savedLogoUrl: null,
      savedName: "",
    },
  });
  let logoInput: HTMLInputElement | undefined;
  let nameInput: HTMLInputElement | undefined;

  /** The host changes its own name and logo; an admin elsewhere asks it to while it is online. */
  const canEditIdentity = () => serverCanAdminister(props.server, "host-admin-v1") && actionsAvailable();
  const address = () => (local() ? props.hostStatus?.apiUrl : props.server.apiUrl);
  const trimmedName = () => panels.identity.name.trim();
  const nameError = () => {
    if (!canEditIdentity()) return null;
    if (trimmedName().length < INPUT_LIMITS.serverNameMin)
      return t("server.settings.nameTooShort", { limit: INPUT_LIMITS.serverNameMin });
    if (trimmedName().length > INPUT_LIMITS.serverName)
      return t("server.settings.nameTooLong", { limit: INPUT_LIMITS.serverName });
    return null;
  };
  const visibleNameError = () => (panels.identity.nameTouched ? nameError() : null);
  /** The owner cannot leave the host they own, and the local server is this computer. */
  const canLeave = () => Boolean(props.onLeaveServer) && !local() && props.server.role !== "owner";
  const identityDirty = () =>
    canEditIdentity() &&
    (trimmedName() !== panels.identity.savedName ||
      panels.identity.logo !== undefined ||
      panels.identity.logoUrl !== panels.identity.savedLogoUrl);

  async function setPublished(value: boolean): Promise<void> {
    const serverId = props.server.id;
    const succeeded = await run("publish", () => props.onSetPublished(value));
    if (!succeeded || props.server.id !== serverId) return;
    setPanels((state) => {
      state.offerRemoteDesktopSetup = value && local() && props.platform === "darwin";
    });
  }

  function dismissRemoteDesktopSetup(): void {
    setPanels((state) => {
      state.offerRemoteDesktopSetup = false;
    });
  }

  async function chooseLogo(file: File | undefined): Promise<void> {
    if (!file) return;
    setPanels((state) => {
      state.identity.logoError = null;
    });
    try {
      const image = await normalizeAvatarFile(file);
      const url = avatarImageDataUrl(image);
      setPanels((state) => {
        state.identity.editing = true;
        state.identity.logo = image;
        state.identity.logoUrl = url;
      });
    } catch (error) {
      setPanels((state) => {
        state.identity.logoError = errorMessage(error, t("server.settings.imageReadFailed"));
      });
    }
  }

  function resetIdentity(): void {
    setPanels((state) => {
      state.identity.name = state.identity.savedName;
      state.identity.logoUrl = state.identity.savedLogoUrl;
      state.identity.logo = undefined;
      state.identity.editing = false;
      state.identity.nameTouched = false;
      state.identity.nameShaking = false;
      state.identity.logoError = null;
    });
  }

  function updateDraftName(value: string): void {
    const namePristine = value.trim() === panels.identity.savedName;
    const logoPristine = panels.identity.logo === undefined && panels.identity.logoUrl === panels.identity.savedLogoUrl;
    // Decided before the write, so `nameError()` still sees the pre-write draft name - the same
    // value it saw when this was a signal, whose write was equally deferred.
    const stopShaking = namePristine || !nameError();
    setPanels((state) => {
      state.identity.name = value;
      state.identity.editing = !(namePristine && logoPristine);
      if (namePristine) state.identity.nameTouched = false;
      if (stopShaking) state.identity.nameShaking = false;
    });
  }

  function restartNameShake(): void {
    setPanels((state) => {
      state.identity.nameShaking = false;
    });
    queueMicrotask(() => {
      if (!nameInput || !nameError()) return;
      void nameInput.offsetWidth;
      setPanels((state) => {
        state.identity.nameShaking = true;
      });
    });
  }

  async function saveIdentity(): Promise<void> {
    setPanels((state) => {
      state.identity.nameTouched = true;
    });
    if (nameError()) {
      restartNameShake();
      queueMicrotask(() => nameInput?.focus({ preventScroll: true }));
      return;
    }
    if (!identityDirty()) return;
    const logo = panels.identity.logo;
    const serverName = trimmedName();
    const saved = await run("identity", () =>
      props.onSaveIdentity({
        serverName,
        // The image crosses to IPC, which structured-clones it, so it goes as a snapshot rather
        // than as whatever the store hands back.
        ...(logo === undefined ? {} : { logo: snapshot(logo) }),
      }),
    );
    if (!saved) return;
    setPanels((state) => {
      state.identity.savedName = serverName;
      state.identity.savedLogoUrl = state.identity.logoUrl;
      state.identity.logo = undefined;
      state.identity.editing = false;
      state.identity.nameTouched = false;
      state.identity.nameShaking = false;
    });
  }

  function syncFromServer(name: string, logoUrl: string | null): void {
    setPanels((state) => {
      state.identity.savedName = name;
      state.identity.name = name;
      state.identity.savedLogoUrl = logoUrl;
      state.identity.logoUrl = logoUrl;
      state.identity.logo = undefined;
      state.identity.nameTouched = false;
      state.identity.nameShaking = false;
    });
  }

  function resetForServer(): void {
    setPanels((state) => {
      state.offerRemoteDesktopSetup = false;
      state.confirmLeave = false;
      state.identity.editing = false;
      state.identity.nameTouched = false;
      state.identity.nameShaking = false;
    });
  }

  function accessDescription() {
    if (!local()) return published() ? t("server.settings.remoteOnline") : t("server.settings.remoteOffline");
    if (!configured()) return t("server.settings.saveIdentityFirst");
    return published() ? t("server.settings.reachable") : t("server.settings.notReachable");
  }

  function Panel() {
    return (
      <>
        <SettingsSection title={t("server.settings.identity")}>
          <Input
            ref={(element) => (logoInput = element)}
            hidden
            type="file"
            aria-label={t("server.settings.logo")}
            accept="image/png,image/jpeg,image/webp"
            disabled={!canEditIdentity()}
            onChange={(event) => {
              void chooseLogo(event.currentTarget.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
          <ItemGroup class="settings-modal-card">
            <Show
              when={canEditIdentity()}
              fallback={
                <Item class="server-settings-readonly-name">
                  <ItemContent>
                    <ItemTitle>{t("server.settings.name")}</ItemTitle>
                    <ItemDescription>{t("server.settings.nameOwnerOnly")}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Text as="span" class="server-settings-readonly-value" variant="body">
                      {props.server.name}
                    </Text>
                  </ItemActions>
                </Item>
              }
            >
              <Item class="settings-identity-name-row">
                <ItemContent>
                  <ItemTitle id="server-settings-name-label">{t("server.settings.name")}</ItemTitle>
                  <ItemDescription id="server-settings-name-description">
                    {t("server.settings.nameDescription")}
                  </ItemDescription>
                </ItemContent>
                <ItemActions class="settings-identity-name-control" data-invalid={visibleNameError() ? "" : undefined}>
                  <Input
                    ref={(element) => (nameInput = element)}
                    class={
                      panels.identity.nameShaking
                        ? "settings-identity-name-input is-shaking"
                        : "settings-identity-name-input"
                    }
                    id="server-settings-name"
                    size="md"
                    maxlength={INPUT_LIMITS.serverName}
                    placeholder={t("server.settings.namePlaceholder")}
                    value={panels.identity.name}
                    aria-labelledby="server-settings-name-label"
                    aria-describedby={
                      visibleNameError() ? "server-settings-name-error" : "server-settings-name-description"
                    }
                    aria-invalid={visibleNameError() ? "true" : undefined}
                    onValueChange={updateDraftName}
                    onBlur={() => {
                      if (trimmedName() === panels.identity.savedName) return;
                      setPanels((state) => {
                        state.identity.nameTouched = true;
                      });
                      if (nameError()) restartNameShake();
                    }}
                    onAnimationEnd={() =>
                      setPanels((state) => {
                        state.identity.nameShaking = false;
                      })
                    }
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || event.isComposing) return;
                      event.preventDefault();
                      void saveIdentity();
                    }}
                  />
                  <span
                    id="server-settings-name-error"
                    class="ui-field-error settings-identity-name-error"
                    role="alert"
                    aria-hidden={visibleNameError() ? undefined : "true"}
                  >
                    {visibleNameError() ?? ""}
                  </span>
                </ItemActions>
              </Item>
            </Show>
            <Item class="settings-identity-image-row">
              <ItemContent>
                <ItemTitle>{t("server.settings.logo")}</ItemTitle>
                <ItemDescription class={panels.identity.logoError ? "server-settings-item-error" : undefined}>
                  {panels.identity.logoError ??
                    (canEditIdentity() ? t("server.settings.logoDescription") : t("server.settings.logoOwnerOnly"))}
                </ItemDescription>
              </ItemContent>
              <ItemActions class="settings-identity-image-control">
                <Show
                  when={canEditIdentity()}
                  fallback={
                    <ServerLogo name={panels.identity.name || props.server.name} url={panels.identity.logoUrl} />
                  }
                >
                  <div class="settings-identity-image-picker ui-removable-image">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-lg"
                      class="settings-identity-image-trigger server-settings-logo-trigger"
                      aria-label={
                        panels.identity.logoUrl ? t("server.settings.editLogo") : t("server.settings.addLogo")
                      }
                      onClick={() => logoInput?.click()}
                    >
                      <Show
                        when={panels.identity.logoUrl}
                        fallback={<Image class="server-settings-logo-placeholder" aria-hidden="true" />}
                      >
                        {(logoUrl) => <ServerLogo name={panels.identity.name || props.server.name} url={logoUrl()} />}
                      </Show>
                    </Button>
                    <Show when={panels.identity.logoUrl}>
                      <ImageRemoveButton
                        class="server-settings-logo-remove"
                        label={t("server.settings.removeLogo")}
                        onClick={() => {
                          setPanels((state) => {
                            state.identity.editing = true;
                            state.identity.logoUrl = null;
                            state.identity.logo = null;
                            state.identity.logoError = null;
                          });
                        }}
                      />
                    </Show>
                  </div>
                </Show>
              </ItemActions>
            </Item>
          </ItemGroup>
        </SettingsSection>
        <SettingsSection title={t("server.settings.access")}>
          <ItemGroup class="settings-modal-card">
            <SwitchField
              class="server-settings-publish-setting"
              size="default"
              checked={published()}
              disabled={!local() || !configured() || Boolean(busy())}
              onChange={(value) => void setPublished(value)}
              label={local() ? t("server.settings.publish") : t("server.settings.published")}
              description={accessDescription()}
            />
            <Item class="server-settings-address-setting">
              <ItemContent>
                <ItemTitle>{t("server.settings.address")}</ItemTitle>
                <ItemDescription>{t("server.settings.addressDescription")}</ItemDescription>
              </ItemContent>
              <Show
                when={address()}
                fallback={
                  <Badge variant="secondary" size="md" shape="pill">
                    {t("server.settings.private")}
                  </Badge>
                }
              >
                {(serverAddress) => (
                  <CopyButton
                    value={serverAddress()}
                    label={truncateMiddle(serverAddress(), 31)}
                    copiedLabel={t("common.copied")}
                    aria-label={t("server.settings.copyAddress")}
                    title={serverAddress()}
                    onCopyError={host.showCopyError}
                    class="server-settings-address-control"
                  />
                )}
              </Show>
            </Item>
          </ItemGroup>
        </SettingsSection>
        <Show when={panels.offerRemoteDesktopSetup}>
          <ItemGroup class="settings-modal-card">
            <Item>
              <ItemContent>
                <ItemTitle>{t("server.settings.setUpDesktopTitle")}</ItemTitle>
                <ItemDescription>{t("server.settings.setUpDesktopDescription")}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button size="sm" variant="ghost" onClick={dismissRemoteDesktopSetup}>
                  {t("server.settings.later")}
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    dismissRemoteDesktopSetup();
                    options.onSetUpDesktop();
                  }}
                >
                  {t("server.settings.setUp")}
                </Button>
              </ItemActions>
            </Item>
          </ItemGroup>
        </Show>
        <Show when={props.onSetMuted && props.onSetNotificationLevel}>
          <SettingsSection title={t("server.settings.notifications")}>
            <ItemGroup class="settings-modal-card">
              <SwitchField
                class="server-settings-mute-setting"
                size="default"
                checked={props.server.notificationsMuted}
                disabled={Boolean(busy())}
                onChange={(value) => void run("mute", () => props.onSetMuted?.(value) ?? Promise.resolve())}
                label={t("server.settings.muteNotifications")}
                description={
                  props.server.notificationsMutedUntil === null
                    ? t("server.settings.muteDescription")
                    : t("server.settings.mutedUntilDescription", {
                        until: serverMuteDescription(props.server, t, format),
                      })
                }
              />
              <Item>
                <ItemContent>
                  <ItemTitle id="server-settings-notification-level-label">
                    {t("server.settings.notifyAbout")}
                  </ItemTitle>
                  <ItemDescription>{t("server.settings.notifyAboutDescription")}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Select<ServerNotificationLevel>
                    options={[...SERVER_NOTIFICATION_LEVELS]}
                    value={props.server.notificationLevel}
                    disabled={Boolean(busy())}
                    placement="bottom-end"
                    onChange={(level) => {
                      if (level)
                        void run(
                          "notification-level",
                          () => props.onSetNotificationLevel?.(level) ?? Promise.resolve(),
                        );
                    }}
                    itemComponent={(item) => (
                      <SelectItem item={item.item}>
                        {t(SERVER_NOTIFICATION_LEVEL_LABELS[item.item.rawValue])}
                      </SelectItem>
                    )}
                  >
                    <SelectTrigger size="sm" aria-labelledby="server-settings-notification-level-label">
                      <SelectValue<ServerNotificationLevel>>
                        {(state) => t(SERVER_NOTIFICATION_LEVEL_LABELS[state.selectedOption()])}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent mount={host.menuMount()} />
                  </Select>
                </ItemActions>
              </Item>
            </ItemGroup>
          </SettingsSection>
        </Show>
        <Show when={canLeave()}>
          <SettingsSection title={t("server.settings.leaveTitle")}>
            <ItemGroup class="settings-modal-card">
              <Item>
                <ItemContent>
                  <ItemTitle>{t("server.settings.leaveTitle")}</ItemTitle>
                  <ItemDescription>{t("server.settings.leaveDescription")}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={Boolean(busy())}
                    onClick={() =>
                      setPanels((state) => {
                        state.confirmLeave = true;
                      })
                    }
                  >
                    {t("server.settings.leaveTitle")}
                  </Button>
                </ItemActions>
              </Item>
            </ItemGroup>
          </SettingsSection>
        </Show>
      </>
    );
  }

  function LeaveDialog() {
    return (
      <Show when={panels.confirmLeave && canLeave()}>
        <LeaveServerDialog
          server={props.server}
          onClose={() =>
            setPanels((state) => {
              state.confirmLeave = false;
            })
          }
          onLeave={async () => {
            await props.onLeaveServer?.();
          }}
        />
      </Show>
    );
  }

  return {
    Panel,
    LeaveDialog,
    editing: () => panels.identity.editing,
    identityDirty,
    resetIdentity,
    saveIdentity,
    syncFromServer,
    resetForServer,
  };
}
