import type { AccountSession, CentralAuthUser, ClientAgentSummary, HostAnalytics } from "@openbot/contracts/ipc";
import {
  Badge,
  Button,
  ConfirmDialog,
  ErrorReference,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Pencil,
  SettingsSection,
  Text,
  Upload,
  UserAvatar,
} from "@openbot/ui";
import { createMemo, createSignal, For, Show } from "solid-js";
import { useText } from "../../text";
import { ProfileActivity, type ProfileActivityPhase } from "./ProfileActivity";
import { ProfileEditDialog } from "./ProfileEditDialog";
import { ProfileShareDialog } from "./ProfileShareDialog";
import { type ProfileStats, profileStats } from "./profile-stats";
import type { SettingsProfileStore } from "./stores/profile-store";

/** The host's report of the past year, and the agents it names. */
export interface ProfileActivityState {
  phase: ProfileActivityPhase;
  report: HostAnalytics | null;
  agents: readonly ClientAgentSummary[];
  errorReference: string | null;
  onRetry: () => void;
  /** Draws the image that the Share dialog shows. The Share button is hidden without it. */
  onCreateShareImage?: ((stats: ProfileStats) => Promise<Blob>) | undefined;
}

interface SettingsProfileTabProps {
  store: SettingsProfileStore;
  account: CentralAuthUser;
  canListSessions: boolean;
  canRevokeSession: boolean;
  /** Signs this computer out of the account. The button is hidden without it. */
  onSignOut?: (() => Promise<void>) | undefined;
  /** The activity of this computer. Nothing shows without it. */
  activity?: ProfileActivityState | undefined;
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
  const { t, format, errorMessage } = useText();
  const [signingOut, setSigningOut] = createSignal(false);
  const [signOutError, setSignOutError] = createSignal<string | null>(null);
  /** The session that the Disconnect confirmation is open for. */
  const [disconnectTarget, setDisconnectTarget] = createSignal<string | null>(null);
  const [editing, setEditing] = createSignal(false);
  const [sharing, setSharing] = createSignal(false);
  const accountName = () => props.account.name?.trim() || props.account.email.split("@")[0] || props.account.email;
  const stats = createMemo(() => {
    const activity = props.activity;
    return activity?.report ? profileStats(activity.report, activity.agents) : null;
  });
  const shareImage = () => {
    const current = stats();
    const create = props.activity?.onCreateShareImage;
    return current && current.tokens > 0 && create ? () => create(current) : undefined;
  };
  const sessionTime = (timestamp: number) => format.date(timestamp, SESSION_TIME_FORMAT);
  const sessionKind = (session: AccountSession) => {
    if (session.hostedServer) return t("settings.profile.sessions.kind.hostedServer");
    return session.kind === "desktop"
      ? t("settings.profile.sessions.kind.desktop")
      : t("settings.profile.sessions.kind.mobile");
  };
  // The reset runs in the click, not in the dialog's render: Solid refuses a store write there.
  function editProfile() {
    props.store.resetName();
    props.store.clearAvatarError();
    setEditing(true);
  }
  async function signOut(onSignOut: () => Promise<void>) {
    if (signingOut()) return;
    setSigningOut(true);
    setSignOutError(null);
    try {
      await onSignOut();
    } catch (cause) {
      setSignOutError(errorMessage(cause, t("account.menu.signOutFailed")));
      setSigningOut(false);
    }
  }
  return (
    <>
      <section class="profile-hero" aria-label={t("settings.profile.header.label")}>
        <UserAvatar user={props.account} class="profile-hero-avatar" decorative />
        <div class="profile-hero-text">
          <h3>{accountName()}</h3>
        </div>
        <div class="profile-hero-actions">
          <Show when={shareImage()}>
            <Button variant="outline" size="sm" onClick={() => setSharing(true)}>
              <Upload size={14} class="profile-icon-share" aria-hidden="true" />
              {t("settings.profile.share.action")}
            </Button>
          </Show>
          <Button variant="outline" size="sm" onClick={editProfile}>
            <Pencil size={14} class="profile-icon-edit" aria-hidden="true" />
            {t("settings.profile.edit.action")}
          </Button>
        </div>
      </section>
      <ProfileEditDialog open={editing()} onOpenChange={setEditing} store={props.store} account={props.account} />
      <Show when={shareImage()}>
        {(createImage) => <ProfileShareDialog open={sharing()} onOpenChange={setSharing} createImage={createImage()} />}
      </Show>
      <Show when={props.activity && props.activity.phase !== "unsupported" ? props.activity : null}>
        {(activity) => (
          <ProfileActivity
            phase={activity().phase}
            stats={stats()}
            errorReference={activity().errorReference}
            onRetry={activity().onRetry}
          />
        )}
      </Show>

      <SettingsSection title={t("settings.profile.account.title")}>
        <ItemGroup class="settings-modal-card">
          <Item data-settings-row="settings.profile.email.title" class="settings-modal-account-email-row">
            <ItemContent>
              <ItemTitle>{t("settings.profile.email.title")}</ItemTitle>
              <ItemDescription>{t("settings.profile.email.description")}</ItemDescription>
              <Show when={signOutError()}>
                {(message) => <ItemDescription role="alert">{message()}</ItemDescription>}
              </Show>
            </ItemContent>
            <ItemActions>
              <Text as="span" class="settings-modal-readonly-value" variant="body">
                {props.account.email}
              </Text>
              <Show when={props.onSignOut}>
                {(onSignOut) => (
                  <Button variant="outline" disabled={signingOut()} onClick={() => void signOut(onSignOut())}>
                    {signingOut() ? t("account.menu.signingOut") : t("account.menu.signOut")}
                  </Button>
                )}
              </Show>
            </ItemActions>
          </Item>
        </ItemGroup>
      </SettingsSection>
      <Show when={props.canListSessions}>
        <SettingsSection
          data-settings-row="settings.profile.sessions.title"
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
                {error().message}
                <ErrorReference reference={error().reference} />
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
                        kind: sessionKind(session),
                        signedIn: sessionTime(session.connectedAt),
                        lastActive: sessionTime(session.lastActiveAt),
                      })}
                    </ItemDescription>
                    <Show when={session.hostedServer && !session.current}>
                      <ItemDescription>{t("settings.profile.sessions.hostedServerNote")}</ItemDescription>
                    </Show>
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
                        onClick={() => setDisconnectTarget(session.sessionId)}
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
          <ConfirmDialog
            open={disconnectTarget() !== null}
            onCancel={() => setDisconnectTarget(null)}
            onConfirm={async () => {
              const sessionId = disconnectTarget();
              if (sessionId === null) return;
              // The store shows a failure under the section heading, so the dialog closes either way.
              await props.store.revokeSession(sessionId);
              setDisconnectTarget(null);
            }}
            title={t("settings.profile.sessions.disconnectConfirm.title")}
            description={t("settings.profile.sessions.disconnectConfirm.description")}
            confirmLabel={t("settings.disconnect.action")}
            pendingLabel={t("settings.disconnect.pending")}
          />
        </SettingsSection>
      </Show>
    </>
  );
}
