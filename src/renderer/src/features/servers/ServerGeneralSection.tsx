import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AvatarImageInput, ServerAppearance } from "@openbot/contracts/ipc";
import {
  Button,
  buttonVariants,
  ConfirmDialog,
  Image,
  ImageRemoveButton,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Popover,
  SettingsSection,
  Text,
} from "@openbot/ui";
import { avatarImageDataUrl, normalizeAvatarFile } from "@openbot/ui/avatar-image";
import { LeaveServerDialog } from "@openbot/ui/features/servers/LeaveServerDialog";
import { ServerAppearancePicker } from "@openbot/ui/features/servers/ServerAppearancePicker";
import { ServerLogo } from "@openbot/ui/features/servers/ServerLogo";
import { ServerPlushLogo } from "@openbot/ui/server-plush-logo";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { type Accessor, createStore, Show, snapshot } from "solid-js";
import { actionToast } from "../../action-toast";
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
  confirmLeave: boolean;
  confirmRotateKey: boolean;
  identity: ServerIdentityDraft;
  /**
   * The plush look that the user chose and the server has not confirmed. `undefined` shows the
   * server's own look, so the picker and the logo change at the click.
   */
  appearance: ServerAppearance | null | undefined;
  appearancePickerOpen: boolean;
}

interface ServerGeneralSection {
  Panel: () => JSX.Element;
  LeaveDialog: () => JSX.Element;
  RotateKeyDialog: () => JSX.Element;
  /** True while the user edits the identity, so the server's own name and logo do not replace the draft. */
  editing: Accessor<boolean>;
  identityDirty: Accessor<boolean>;
  resetIdentity(): void;
  saveIdentity(): Promise<void>;
  /**
   * Saves a valid name or logo that the user did not save, and says whether nothing failed. Members
   * calls it before it publishes an unnamed server, so that the server does not get a generated name.
   */
  saveIdentityDraft(): Promise<boolean>;
  /** Shows the name and logo the server holds now, while the user does not edit them. */
  syncFromServer(name: string, logoUrl: string | null): void;
  /** Forgets the draft state of the previous server when the dialog shows another one. */
  resetForServer(): void;
}

/** The General section: server identity, agent settings, and leaving a joined server. */
export function createServerGeneralSection(host: ServerSettingsSectionHost): ServerGeneralSection {
  const { t, errorMessage, format } = useText();
  const { props, local, configured, published, actionsAvailable, busy, run } = host;
  const [panels, setPanels] = createStore<GeneralPanels>({
    confirmLeave: false,
    confirmRotateKey: false,
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
    appearance: undefined,
    appearancePickerOpen: false,
  });
  let logoInput: HTMLInputElement | undefined;
  let nameInput: HTMLInputElement | undefined;

  /** The host changes its own name and logo; an admin elsewhere asks it to while it is online. */
  const canEditIdentity = () => serverCanAdminister(props.server, "host-admin-v1") && actionsAvailable();
  /**
   * An owner or admin chooses the plush look. A joined server needs `host-appearance-v1`; this
   * computer's server needs an identity first, which the first save of the name gives.
   */
  const canEditAppearance = () =>
    Boolean(props.onSaveAppearance) &&
    serverCanAdminister(props.server, "host-appearance-v1") &&
    actionsAvailable() &&
    (!local() || configured());
  const appearance = (): ServerAppearance | null =>
    panels.appearance === undefined ? (props.server.appearance ?? null) : panels.appearance;
  /** A choice made while a save runs; it is sent when that save ends, so the last click wins. */
  let queuedAppearance: ServerAppearance | null | undefined;
  let savingAppearance = false;
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
  /** The owner removes the server from the account instead. The host does not need to be online. */
  const canRemove = () => Boolean(props.onRemoveServer) && !local() && props.server.role === "owner";
  /**
   * The key handover goes through the account service, so this computer's server must be published.
   * A joined server's owner asks the host while it is online.
   */
  const canRotateKey = () => Boolean(props.onRotateHostKey) && (local() ? published() : actionsAvailable());
  /** The last key change that the previous and the new key both signed. Every member sees it. */
  const keyChangedAt = () => props.server.keyChangedAt;
  const identityDirty = () =>
    canEditIdentity() &&
    (trimmedName() !== panels.identity.savedName ||
      panels.identity.logo !== undefined ||
      panels.identity.logoUrl !== panels.identity.savedLogoUrl);

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

  async function saveAppearance(next: ServerAppearance | null): Promise<void> {
    setPanels((state) => {
      state.appearance = next;
    });
    if (savingAppearance) {
      queuedAppearance = next;
      return;
    }
    const save = props.onSaveAppearance;
    if (!save) return;
    savingAppearance = true;
    let value = next;
    try {
      for (;;) {
        const sent = value;
        const saved = await run("appearance", () => save(sent));
        if (queuedAppearance === undefined || !saved) break;
        value = queuedAppearance;
        queuedAppearance = undefined;
      }
    } finally {
      savingAppearance = false;
      queuedAppearance = undefined;
      // The server's own look shows again: the saved one, or the previous one after a failure.
      setPanels((state) => {
        state.appearance = undefined;
      });
    }
  }

  async function saveIdentityDraft(): Promise<boolean> {
    if (!identityDirty() || nameError()) return true;
    await saveIdentity();
    return !identityDirty();
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
      state.confirmLeave = false;
      state.confirmRotateKey = false;
      state.appearance = undefined;
      state.appearancePickerOpen = false;
      state.identity.editing = false;
      state.identity.nameTouched = false;
      state.identity.nameShaking = false;
    });
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
            accept="image/png,image/jpeg,image/gif,image/webp"
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
                {/* The plush shows only while the server has no logo, so its picker does too. */}
                <Show when={canEditAppearance() && !panels.identity.logoUrl}>
                  <Popover.Root
                    open={panels.appearancePickerOpen}
                    placement="bottom-end"
                    gutter={8}
                    onOpenChange={(open) =>
                      setPanels((state) => {
                        state.appearancePickerOpen = open;
                      })
                    }
                  >
                    <Popover.Trigger
                      class={buttonVariants({
                        variant: "outline",
                        size: "icon-lg",
                        class: "settings-identity-image-trigger server-appearance-trigger",
                      })}
                      aria-label={t("server.settings.appearance")}
                      // Another action holds `run`, which would refuse the save with no message.
                      disabled={Boolean(busy()) && busy() !== "appearance"}
                    >
                      <ServerPlushLogo class="server-settings-plush" seed={props.server.id} appearance={appearance()} />
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Content class="avatar-editor">
                        <Popover.Title class="sr-only">{t("server.settings.appearance")}</Popover.Title>
                        <ServerAppearancePicker
                          serverId={props.server.id}
                          appearance={appearance()}
                          onChange={(next) => void saveAppearance(next)}
                        />
                      </Popover.Content>
                    </Popover.Portal>
                  </Popover.Root>
                </Show>
                <Show
                  when={canEditIdentity()}
                  fallback={
                    <ServerLogo serverId={props.server.id} url={panels.identity.logoUrl} appearance={appearance()} />
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
                        {(logoUrl) => (
                          <ServerLogo serverId={props.server.id} url={logoUrl()} appearance={appearance()} />
                        )}
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
        <Show when={canRotateKey() || keyChangedAt() !== undefined}>
          <SettingsSection title={t("server.settings.hostKeyTitle")}>
            <ItemGroup class="settings-modal-card">
              <Show when={keyChangedAt() !== undefined}>
                <Item>
                  <ItemContent>
                    <ItemTitle>{t("server.settings.hostKeyChanged")}</ItemTitle>
                    <ItemDescription>
                      {t("server.settings.hostKeyChangedDescription", {
                        date: format.date(new Date(keyChangedAt() ?? 0), { dateStyle: "medium", timeStyle: "short" }),
                      })}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              </Show>
              <Show when={canRotateKey()}>
                <Item>
                  <ItemContent>
                    <ItemTitle>{t("server.settings.hostKeyRotate")}</ItemTitle>
                    <ItemDescription>{t("server.settings.hostKeyDescription")}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={Boolean(busy())}
                      onClick={() =>
                        setPanels((state) => {
                          state.confirmRotateKey = true;
                        })
                      }
                    >
                      {t("server.settings.hostKeyRotateAction")}
                    </Button>
                  </ItemActions>
                </Item>
              </Show>
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
        <Show when={canRemove()}>
          <SettingsSection title={t("server.settings.removeTitle")}>
            <ItemGroup class="settings-modal-card">
              <Item>
                <ItemContent>
                  <ItemTitle>{t("server.settings.removeTitle")}</ItemTitle>
                  <ItemDescription>{t("server.settings.removeDescription")}</ItemDescription>
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
                    {t("server.settings.removeTitle")}
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
      <Show when={panels.confirmLeave && (canLeave() || canRemove())}>
        <LeaveServerDialog
          server={props.server}
          removeOwned={canRemove()}
          onClose={() =>
            setPanels((state) => {
              state.confirmLeave = false;
            })
          }
          onLeave={async () => {
            await (canRemove() ? props.onRemoveServer?.() : props.onLeaveServer?.());
          }}
        />
      </Show>
    );
  }

  function RotateKeyDialog() {
    const close = () =>
      setPanels((state) => {
        state.confirmRotateKey = false;
      });
    return (
      <Show when={panels.confirmRotateKey && canRotateKey()}>
        <ConfirmDialog
          open
          tone="default"
          initialFocus="cancel"
          pending={busy() === "rotate-host-key"}
          title={t("server.settings.hostKeyConfirmTitle")}
          description={t("server.settings.hostKeyConfirmDescription")}
          confirmLabel={t("server.settings.hostKeyRotateAction")}
          onCancel={close}
          onConfirm={async () => {
            await run("rotate-host-key", async () => {
              await props.onRotateHostKey?.();
              close();
              actionToast.success(t("server.settings.hostKeyRotated"));
            });
          }}
        />
      </Show>
    );
  }

  return {
    Panel,
    LeaveDialog,
    RotateKeyDialog,
    editing: () => panels.identity.editing,
    identityDirty,
    resetIdentity,
    saveIdentity,
    saveIdentityDraft,
    syncFromServer,
    resetForServer,
  };
}
