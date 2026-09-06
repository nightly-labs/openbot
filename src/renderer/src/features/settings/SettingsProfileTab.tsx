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
import type { SettingsProfileStore } from "./stores/profile-store";

interface SettingsProfileTabProps {
  store: SettingsProfileStore;
  account: CentralAuthUser;
  canListSessions: boolean;
  canRevokeSession: boolean;
}

export function SettingsProfileTab(props: SettingsProfileTabProps) {
  return (
    <>
      <SettingsSection title="Identity">
        <Input
          ref={(element) => props.store.registerAvatarInput(element)}
          class="sr-only"
          type="file"
          aria-label="Upload profile photo"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => void props.store.uploadAvatar(event.currentTarget.files?.[0])}
        />
        <ItemGroup class="settings-modal-card">
          <Item class="settings-identity-name-row">
            <ItemContent>
              <ItemTitle id="settings-profile-name-label">Display name</ItemTitle>
              <ItemDescription id="settings-profile-name-description">Visible in shared workspaces.</ItemDescription>
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
              <ItemTitle>Profile photo</ItemTitle>
              <ItemDescription class={props.store.state.avatar.error ? "settings-modal-error" : undefined}>
                {props.store.state.avatar.error ?? "Shown with your profile in OpenBot."}
              </ItemDescription>
            </ItemContent>
            <ItemActions class="settings-identity-image-control">
              <div class="settings-identity-image-picker ui-removable-image">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-lg"
                  class="settings-identity-image-trigger settings-modal-profile-photo-trigger"
                  aria-label={props.account.avatarUrl ? "Edit profile photo" : "Add profile photo"}
                  disabled={props.store.state.avatar.busy}
                  onClick={props.store.openAvatarPicker}
                >
                  <UserAvatar user={props.account} class="settings-modal-avatar" decorative />
                </Button>
                <Show when={props.account.avatarUrl && !props.store.state.avatar.busy}>
                  <ImageRemoveButton label="Remove profile photo" onClick={() => void props.store.updateAvatar(null)} />
                </Show>
              </div>
            </ItemActions>
          </Item>
        </ItemGroup>
      </SettingsSection>

      <SettingsSection title="Account">
        <ItemGroup class="settings-modal-card">
          <Item class="settings-modal-account-email-row">
            <ItemContent>
              <ItemTitle>Email</ItemTitle>
              <ItemDescription>Used to sign in to OpenBot.</ItemDescription>
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
          title="Account sessions"
          description="Sessions stay signed in until you log out or disconnect them. Disconnecting also ends this account's active remote connections."
        >
          <Button
            variant="outline"
            disabled={props.store.state.sessions.loading || Boolean(props.store.state.sessions.revokingId)}
            onClick={() => void props.store.refreshSessions()}
          >
            {props.store.state.sessions.loading ? "Loading sessions…" : "Refresh sessions"}
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
                      {session.current ? " · This device" : ""}
                    </ItemTitle>
                    <ItemDescription>
                      {session.kind === "desktop" ? "Desktop" : "Mobile"} · Signed in{" "}
                      {new Date(session.connectedAt).toLocaleString()} · Last active{" "}
                      {new Date(session.lastActiveAt).toLocaleString()}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Show when={!session.current} fallback={<Badge>This device</Badge>}>
                      <Button
                        variant="outline"
                        aria-label={`Disconnect ${session.name} session from ${new Date(session.connectedAt).toLocaleString()}`}
                        disabled={Boolean(props.store.state.sessions.revokingId) || !props.canRevokeSession}
                        onClick={() => void props.store.revokeSession(session.sessionId)}
                      >
                        {props.store.state.sessions.revokingId === session.sessionId ? "Disconnecting…" : "Disconnect"}
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
