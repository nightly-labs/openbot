import type { GitHubConnectorStatus, OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";

export type GitHubConnectorPort = Pick<
  OpenBotDesktopApi["githubConnector"],
  "status" | "connect" | "cancel" | "disconnect" | "repositories" | "openVerification" | "openInstall" | "onChanged"
>;

export function githubConnectorPort(): GitHubConnectorPort {
  return window.openbot.githubConnector;
}

const HOST_POLL_MS = 2_000;
const HOST_POLL_FAILURE_LIMIT = 450;

export function polledGitHubConnectorPort(actions: Omit<GitHubConnectorPort, "onChanged">): GitHubConnectorPort {
  const listeners = new Set<(status: GitHubConnectorStatus) => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  let failures = 0;
  let generation = 0;
  const stop = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const schedule = () => {
    if (!pending || timer !== null || listeners.size === 0 || failures >= HOST_POLL_FAILURE_LIMIT) return;
    const read = generation;
    timer = setTimeout(() => {
      timer = null;
      void actions.status().then(
        (status) => {
          if (read === generation) seen(status);
        },
        () => {
          if (read !== generation) return;
          failures += 1;
          schedule();
        },
      );
    }, HOST_POLL_MS);
  };
  const seen = (status: GitHubConnectorStatus) => {
    for (const listener of listeners) listener(status);
    pending = status.state === "pending";
    failures = 0;
    if (pending) schedule();
    else stop();
    return status;
  };
  const tracked = (action: () => Promise<GitHubConnectorStatus>) => async () => {
    generation += 1;
    stop();
    try {
      return seen(await action());
    } catch (error) {
      schedule();
      throw error;
    }
  };
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
