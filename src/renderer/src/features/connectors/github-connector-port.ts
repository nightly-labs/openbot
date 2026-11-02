import type { GitHubConnectorStatus, OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";

/** What the GitHub app page reaches: one GitHub connection, of this computer or of a joined server. */
export type GitHubConnectorPort = Pick<
  OpenBotDesktopApi["githubConnector"],
  "status" | "connect" | "cancel" | "disconnect" | "repositories" | "openVerification" | "openInstall" | "onChanged"
>;

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function githubConnectorPort(): GitHubConnectorPort {
  return window.openbot.githubConnector;
}

/** How often a joined server's connection is read while its sign-in waits for the user on GitHub. */
const HOST_POLL_MS = 2_000;

/**
 * A port to a joined server's connection (`connectors-v1`). The host sends no event, so `onChanged`
 * reads the status while a sign-in waits for the user, and stops when the sign-in ends or a read fails.
 */
export function polledGitHubConnectorPort(actions: Omit<GitHubConnectorPort, "onChanged">): GitHubConnectorPort {
  const listeners = new Set<(status: GitHubConnectorStatus) => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const seen = (status: GitHubConnectorStatus) => {
    for (const listener of listeners) listener(status);
    if (status.state !== "pending") stop();
    else if (timer === null && listeners.size > 0)
      timer = setTimeout(() => {
        timer = null;
        void actions.status().then(seen, () => undefined);
      }, HOST_POLL_MS);
    return status;
  };
  const tracked = (action: () => Promise<GitHubConnectorStatus>) => async () => seen(await action());
  return {
    ...actions,
    status: tracked(actions.status),
    connect: tracked(actions.connect),
    cancel: tracked(actions.cancel),
    disconnect: tracked(actions.disconnect),
    onChanged: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
  };
}

/** The connection of the joined server that `serverId` names, through main. */
export function hostGitHubConnectorPort(serverId: () => string | undefined): GitHubConnectorPort {
  const call =
    <T>(method: (api: OpenBotDesktopApi["githubConnector"], serverId: string) => Promise<T>) =>
    () => {
      const id = serverId();
      if (!id) return Promise.reject(new Error(sourceText("error.team.connectorsUnsupported")));
      return method(window.openbot.githubConnector, id);
    };
  return polledGitHubConnectorPort({
    status: call((api, id) => api.hostStatus(id)),
    connect: call((api, id) => api.hostConnect(id)),
    cancel: call((api, id) => api.hostCancel(id)),
    disconnect: call((api, id) => api.hostDisconnect(id)),
    repositories: call((api, id) => api.hostRepositories(id)),
    openVerification: call((api, id) => api.hostOpenVerification(id)),
    openInstall: call((api, id) => api.hostOpenInstall(id)),
  });
}
