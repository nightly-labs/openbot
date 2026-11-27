import type { CentralAuthUser } from "@openbot/contracts/ipc";
import type { RemoteTeamHost } from "@openbot/team-client/remote-directory";
import { LogOut, PlushLoader, RefreshCw, UserAvatar } from "@openbot/ui";
import { ServerPlushLogo } from "@openbot/ui/server-plush-logo";
import { useText } from "@openbot/ui/text";
import { For, Show } from "solid-js";

interface ConnectingScreenProps {
  hosts: RemoteTeamHost[];
  host: RemoteTeamHost;
  user: CentralAuthUser;
  failure: string | null;
  onSelectHost: (hostId: string) => void;
  onRetry: () => void;
  onSignOut: () => void;
}

function accountName(user: CentralAuthUser): string {
  if (user.name) return user.name;
  const separator = user.email.indexOf("@");
  return separator > 0 ? user.email.slice(0, separator) : user.email;
}

export function ConnectingScreen(props: ConnectingScreenProps) {
  const { t } = useText();
  const status = () =>
    t("extension.connection.remoteStatus", {
      status: props.failure === null ? t("common.connecting") : t("extension.connection.notConnected"),
    });
  const detail = (hostId: string) => (hostId === props.host.hostId ? status() : t("extension.connection.remote"));

  return (
    <div class="ext-connect">
      <header class="ext-connect-head">
        <ServerPlushLogo
          seed={props.host.hostId}
          appearance={props.host.appearance ?? null}
          class="ext-connect-head-mark"
        />
        <div class="ext-connect-text">
          <h1 class="ext-connect-title" dir="auto">
            {props.host.name}
          </h1>
          <p class="ext-connect-caption" data-failed={props.failure === null ? undefined : ""} aria-live="polite">
            {props.failure ?? status()}
          </p>
        </div>
        <button
          type="button"
          class="ext-connect-icon-button"
          aria-label={t("common.retry")}
          onClick={() => props.onRetry()}
        >
          <RefreshCw size={18} aria-hidden="true" />
        </button>
      </header>
      <ul class="ext-connect-rows">
        <For each={props.hosts}>
          {(entry) => {
            const selected = () => entry.hostId === props.host.hostId;
            return (
              <li>
                <button
                  type="button"
                  class="ext-connect-row"
                  aria-current={selected() ? "true" : undefined}
                  onClick={() => props.onSelectHost(entry.hostId)}
                >
                  <ServerPlushLogo
                    seed={entry.hostId}
                    appearance={entry.appearance ?? null}
                    class="ext-connect-row-mark"
                  />
                  <span class="ext-connect-text">
                    <span class="ext-connect-row-name" dir="auto">
                      {entry.name}
                    </span>
                    <span class="ext-connect-caption">{detail(entry.hostId)}</span>
                  </span>
                  <Show when={selected() && props.failure === null}>
                    <PlushLoader size={18} label={t("extension.connection.connecting", { server: entry.name })} />
                  </Show>
                </button>
              </li>
            );
          }}
        </For>
      </ul>
      <footer class="ext-connect-account">
        <UserAvatar user={props.user} decorative class="ext-connect-avatar" />
        <span class="ext-connect-text">
          <span class="ext-connect-account-name" dir="auto">
            {accountName(props.user)}
          </span>
          <span class="ext-connect-account-email" dir="auto">
            {props.user.email}
          </span>
        </span>
        <button type="button" class="ext-connect-sign-out" onClick={() => props.onSignOut()}>
          <LogOut size={16} aria-hidden="true" />
          {t("extension.home.signOut")}
        </button>
      </footer>
    </div>
  );
}
