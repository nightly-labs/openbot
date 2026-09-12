import type { CentralAuthUser } from "@openbot/contracts/ipc";
import { For, Show } from "solid-js";
import {
  Badge,
  Button,
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
} from "../../components/ui";
import { useI18n } from "../i18n/i18n-context";
import type { SettingsProfileStore } from "./stores/profile-store";

interface SettingsProfileTabProps {
  store: SettingsProfileStore;
  account: CentralAuthUser;
  canListSessions: boolean;
  canRevokeSession: boolean;
}

export function SettingsProfileTab(props: SettingsProfileTabProps) {
  const i18n = useI18n();
  return (
    <>
      <SettingsSection title={i18n.t("settings.profile.identity")}>
        <Input
          ref={(element) => props.store.registerAvatarInput(element)}
          class="sr-only"
          type="file"
          aria-label={i18n.t("settings.profile.uploadPhoto")}
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => void props.store.uploadAvatar(event.currentTarget.files?.[0])}
        />
        <ItemGroup class="settings-modal-card">
          <Item class="settings-identity-name-row">
            <ItemContent>
              <ItemTitle id="settings-profile-name-label">{i18n.t("settings.profile.displayName")}</ItemTitle>
              <ItemDescription id="settings-profile-name-description">
                {i18n.t("settings.profile.displayNameDescription")}
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
              <ItemTitle>{i18n.t("settings.profile.photo")}</ItemTitle>
              <ItemDescription class={props.store.state.avatar.error ? "settings-modal-error" : undefined}>
                {props.store.state.avatar.error ?? i18n.t("settings.profile.photoDescription")}
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
                    props.account.avatarUrl ? i18n.t("settings.profile.editPhoto") : i18n.t("settings.profile.addPhoto")
                  }
                  disabled={props.store.state.avatar.busy}
                  onClick={props.store.openAvatarPicker}
                >
                  <UserAvatar user={props.account} class="settings-modal-avatar" decorative />
                </Button>
                <Show when={props.account.avatarUrl && !props.store.state.avatar.busy}>
                  <ImageRemoveButton
                    label={i18n.t("settings.profile.removePhoto")}
                    onClick={() => void props.store.updateAvatar(null)}
                  />
                </Show>
              </div>
            </ItemActions>
          </Item>
        </ItemGroup>
      </SettingsSection>

      <SettingsSection title={i18n.t("settings.profile.account")}>
        <ItemGroup class="settings-modal-card">
          <Item class="settings-modal-account-email-row">
            <ItemContent>
              <ItemTitle>{i18n.t("settings.profile.email")}</ItemTitle>
              <ItemDescription>{i18n.t("settings.profile.emailDescription")}</ItemDescription>
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
          title={i18n.t("settings.profile.sessions")}
          description={i18n.t("settings.profile.sessionsDescription")}
        >
          <Button
            variant="outline"
            disabled={props.store.state.sessions.loading || Boolean(props.store.state.sessions.revokingId)}
            onClick={() => void props.store.refreshSessions()}
          >
            {props.store.state.sessions.loading
              ? i18n.t("settings.profile.loadingSessions")
              : i18n.t("settings.profile.refreshSessions")}
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
                      {session.current ? ` · ${i18n.t("settings.profile.thisDevice")}` : ""}
                    </ItemTitle>
                    <ItemDescription>
                      {session.kind === "desktop"
                        ? i18n.t("settings.profile.desktop")
                        : i18n.t("settings.profile.mobile")}{" "}
                      · {i18n.t("settings.profile.signedIn")} {new Date(session.connectedAt).toLocaleString()} · Last
                      active {new Date(session.lastActiveAt).toLocaleString()}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Show when={!session.current} fallback={<Badge>{i18n.t("settings.profile.thisDevice")}</Badge>}>
                      <Button
                        variant="outline"
                        aria-label={`${i18n.t("settings.profile.disconnectSession")} ${session.name}`}
                        disabled={Boolean(props.store.state.sessions.revokingId) || !props.canRevokeSession}
                        onClick={() => void props.store.revokeSession(session.sessionId)}
                      >
                        {props.store.state.sessions.revokingId === session.sessionId
                          ? i18n.t("settings.profile.disconnecting")
                          : i18n.t("settings.profile.disconnect")}
                      </Button>
                    </Show>
                  </ItemActions>
                </Item>
              )}
            </For>
          </ItemGroup>
        </SettingsSection>
      </Show>
    </>
  );
}
