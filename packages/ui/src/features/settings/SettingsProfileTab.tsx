import type { CentralAuthUser } from "@openbot/contracts/ipc";
import {
  Badge,
  Button,
  ConfirmDialog,
  Field,
  ImageRemoveButton,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  SettingsSection,
  Text,
  UserAvatar,
} from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import type { SettingsProfileStore } from "./stores/profile-store";

interface SettingsProfileTabProps {
  store: SettingsProfileStore;
  account: CentralAuthUser;
  canListSessions: boolean;
  canRevokeSession: boolean;
  canDeleteAccount?: boolean;
}

/** `Date.prototype.toLocaleString()` with no options: the date and the time, each field numeric. */
const SESSION_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
};
const SESSION_TITLE_SEPARATOR = " · ";

export function SettingsProfileTab(props: SettingsProfileTabProps) {
  const { t, format } = useText();
  const sessionTime = (timestamp: number) => format.date(timestamp, SESSION_TIME_FORMAT);
  return (
    <>
      <SettingsSection title={t("settings.profile.identity.title")}>
        <Input
          ref={(element) => props.store.registerAvatarInput(element)}
          class="sr-only"
          type="file"
          aria-label={t("settings.profile.photo.upload")}
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => void props.store.uploadAvatar(event.currentTarget.files?.[0])}
        />
        <ItemGroup class="settings-modal-card">
          <Item class="settings-identity-name-row">
            <ItemContent>
              <ItemTitle id="settings-profile-name-label">{t("settings.profile.name.title")}</ItemTitle>
              <ItemDescription id="settings-profile-name-description">
                {t("settings.profile.name.description")}
              </ItemDescription>
            </ItemContent>
            <ItemActions
              class="settings-identity-name-control"
              data-invalid={props.store.visibleNameError() ? "" : undefined}
            >
              <Input
                ref={(element) => props.store.registerNameInput(element)}
                class="settings-identity-name-input"
                id="settings-profile-name"
                size="md"
                value={props.store.state.profile.name}
                aria-labelledby="settings-profile-name-label"
                aria-describedby={
                  props.store.visibleNameError() ? "settings-profile-name-error" : "settings-profile-name-description"
                }
                aria-invalid={props.store.visibleNameError() ? "true" : undefined}
                onValueChange={props.store.updateName}
                onBlur={props.store.markTouchedIfDirty}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.isComposing) return;
                  event.preventDefault();
                  void props.store.saveName();
                }}
              />
              <span
                id="settings-profile-name-error"
                class="ui-field-error settings-identity-name-error"
                role="alert"
                aria-hidden={props.store.visibleNameError() ? undefined : "true"}
              >
                {props.store.visibleNameError() ?? ""}
              </span>
            </ItemActions>
          </Item>
          <Item class="settings-identity-image-row">
            <ItemContent>
              <ItemTitle>{t("settings.profile.photo.title")}</ItemTitle>
              <ItemDescription class={props.store.state.avatar.error ? "settings-modal-error" : undefined}>
                {props.store.state.avatar.error ?? t("settings.profile.photo.description")}
              </ItemDescription>
            </ItemContent>
            <ItemActions class="settings-identity-image-control">
              <div class="settings-identity-image-picker ui-removable-image">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-lg"
                  class="settings-identity-image-trigger settings-modal-profile-photo-trigger"
                  aria-label={
                    props.account.avatarUrl ? t("settings.profile.photo.edit") : t("settings.profile.photo.add")
                  }
                  disabled={props.store.state.avatar.busy}
                  onClick={props.store.openAvatarPicker}
                >
                  <UserAvatar user={props.account} class="settings-modal-avatar" decorative />
                </Button>
                <Show when={props.account.avatarUrl && !props.store.state.avatar.busy}>
                  <ImageRemoveButton
                    label={t("settings.profile.photo.remove")}
                    onClick={() => void props.store.updateAvatar(null)}
                  />
                </Show>
              </div>
            </ItemActions>
          </Item>
        </ItemGroup>
      </SettingsSection>

      <SettingsSection title={t("settings.profile.account.title")}>
        <ItemGroup class="settings-modal-card">
          <Item class="settings-modal-account-email-row">
            <ItemContent>
              <ItemTitle>{t("settings.profile.email.title")}</ItemTitle>
              <ItemDescription>{t("settings.profile.email.description")}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Text as="span" class="settings-modal-readonly-value" variant="body">
                {props.account.email}
              </Text>
            </ItemActions>
          </Item>
        </ItemGroup>
      </SettingsSection>
      <Show when={props.canListSessions}>
        <SettingsSection
          title={t("settings.profile.sessions.title")}
          description={t("settings.profile.sessions.description")}
        >
          <Button
            variant="outline"
            disabled={props.store.state.sessions.loading || Boolean(props.store.state.sessions.revokingId)}
            onClick={() => void props.store.refreshSessions()}
          >
            {props.store.state.sessions.loading
              ? t("settings.profile.sessions.loading")
              : t("settings.profile.sessions.refresh")}
          </Button>
          <Show when={props.store.state.sessions.error}>
            {(error) => (
              <Text role="alert" class="settings-modal-error">
                {error()}
              </Text>
            )}
          </Show>
          <ItemGroup class="settings-modal-card">
            <For each={props.store.state.sessions.items}>
              {(session) => (
                <Item>
                  <ItemContent>
                    <ItemTitle>
                      {session.name}
                      {session.current ? `${SESSION_TITLE_SEPARATOR}${t("settings.profile.sessions.thisDevice")}` : ""}
                    </ItemTitle>
                    <ItemDescription>
                      {t("settings.profile.sessions.details", {
                        kind:
                          session.kind === "desktop"
                            ? t("settings.profile.sessions.kind.desktop")
                            : t("settings.profile.sessions.kind.mobile"),
                        signedIn: sessionTime(session.connectedAt),
                        lastActive: sessionTime(session.lastActiveAt),
                      })}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Show when={!session.current} fallback={<Badge>{t("settings.profile.sessions.thisDevice")}</Badge>}>
                      <Button
                        variant="outline"
                        aria-label={t("settings.profile.sessions.disconnectLabel", {
                          name: session.name,
                          signedIn: sessionTime(session.connectedAt),
                        })}
                        disabled={Boolean(props.store.state.sessions.revokingId) || !props.canRevokeSession}
                        onClick={() => void props.store.revokeSession(session.sessionId)}
                      >
                        {props.store.state.sessions.revokingId === session.sessionId
                          ? t("settings.disconnect.pending")
                          : t("settings.disconnect.action")}
                      </Button>
                    </Show>
                  </ItemActions>
                </Item>
              )}
            </For>
          </ItemGroup>
        </SettingsSection>
      </Show>
      <Show when={props.canDeleteAccount}>
        <SettingsSection title={t("settings.profile.delete.title")}>
          <ItemGroup class="settings-modal-card">
            <Item>
              <ItemContent>
                <ItemTitle>{t("settings.profile.delete.title")}</ItemTitle>
                <ItemDescription>{t("settings.profile.delete.description")}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button
                  variant="destructive"
                  disabled={props.store.state.deletion.busy}
                  onClick={props.store.requestDeleteAccount}
                >
                  {t("settings.profile.delete.action")}
                </Button>
              </ItemActions>
            </Item>
          </ItemGroup>
        </SettingsSection>
        <ConfirmDialog
          open={props.store.state.deletion.open}
          title={t("settings.profile.delete.dialogTitle")}
          description={t("settings.profile.delete.dialogDescription")}
          confirmLabel={t("settings.profile.delete.action")}
          pendingLabel={t("settings.profile.delete.deleting")}
          pending={props.store.state.deletion.busy}
          error={props.store.state.deletion.error ?? undefined}
          initialFocus="cancel"
          onCancel={props.store.cancelDeleteAccount}
          onConfirm={props.store.confirmDeleteAccount}
        >
          <Field label={t("settings.profile.delete.confirmLabel", { email: props.account.email })}>
            <Input
              type="email"
              value={props.store.state.deletion.confirmEmail}
              autocomplete="off"
              spellcheck={false}
              disabled={props.store.state.deletion.busy}
              onValueChange={props.store.setDeleteConfirmEmail}
            />
          </Field>
        </ConfirmDialog>
      </Show>
    </>
  );
}
