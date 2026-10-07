import {
  DISCONNECTED_GITHUB_CONNECTOR,
  type GitHubConnectorRepositories,
  type GitHubConnectorStatus,
} from "@openbot/contracts/ipc";
import { classifyFailure } from "@openbot/telemetry";
import type { GitHubConnectorPanelProps } from "@openbot/ui/features/settings/GitHubConnectorPanel";
import { currentText } from "@openbot/ui/text";
import { createEffect, createSignal, onCleanup, onSettled } from "solid-js";
import { actionToast } from "../../action-toast";
import { type GitHubConnectorPort, githubConnectorPort } from "./github-connector-port";

export interface GitHubConnectorController {
  status: () => GitHubConnectorStatus;
  busy: () => boolean;
  /** Null until the first list arrives, and while the connection is not active. */
  repositories: () => GitHubConnectorRepositories | null;
  /** Why the last list could not be read. The last list that was read stays. */
  repositoriesError: () => string | null;
  /** Reads the status and the repositories again, for a view that opens. */
  reload: () => void;
  connect: () => void;
  cancel: () => void;
  disconnect: () => void;
  openVerification: () => void;
  openInstall: () => void;
}

/**
 * The GitHub connection of this computer, for the owner that shows it. Reads the status once and
 * then follows main's `changed` event, because the sign-in finishes in the browser, outside this
 * window. Call it inside a component: the subscription ends with that component.
 *
 * The repository list is read when the connection becomes active, on each `reload`, and when this
 * window gets the focus back after "Choose repositories" opened GitHub.
 *
 * Cancel does not wait for another action. The connect action waits for GitHub's first answer, and
 * Cancel is the way out of that wait.
 */
export function createGitHubConnector(
  port: () => GitHubConnectorPort = githubConnectorPort,
): GitHubConnectorController {
  const [status, setStatus] = createSignal<GitHubConnectorStatus>(DISCONNECTED_GITHUB_CONNECTOR);
  const [busy, setBusy] = createSignal(false);
  const [repositories, setRepositories] = createSignal<GitHubConnectorRepositories | null>(null);
  const [repositoriesError, setRepositoriesError] = createSignal<string | null>(null);
  let disposed = false;
  /** Each read replaces the one before it, so a slow answer never overwrites a newer one. */
  let repositoriesRead = 0;
  /** Set when GitHub opened to change the repositories. The next window focus reads them again. */
  let awaitingInstall = false;

  const readRepositories = () => {
    const read = ++repositoriesRead;
    void port()
      .repositories()
      .then((next) => {
        if (disposed || read !== repositoriesRead) return;
        setRepositories(next);
        setRepositoriesError(null);
      })
      .catch((error: unknown) => {
        if (disposed || read !== repositoriesRead) return;
        const { t, errorMessage } = currentText();
        setRepositoriesError(errorMessage(error, t("connector.github.repositoriesFailed")));
      });
  };
  createEffect(
    () => status().state,
    (state) => {
      if (state === "connected") {
        readRepositories();
        return;
      }
      repositoriesRead += 1;
      setRepositories(null);
      setRepositoriesError(null);
    },
  );
  const onFocus = () => {
    if (!awaitingInstall || status().state !== "connected") return;
    awaitingInstall = false;
    readRepositories();
  };
  window.addEventListener("focus", onFocus);

  const unsubscribe = port().onChanged((next) => {
    if (!disposed) setStatus(next);
  });
  // A failed read keeps the last status. The next `reload` or `changed` event replaces it.
  const reload = () => {
    if (status().state === "connected") readRepositories();
    void port()
      .status()
      .then((next) => {
        if (!disposed) setStatus(next);
      })
      .catch(() => undefined);
  };
  onSettled(reload);
  onCleanup(() => {
    disposed = true;
    unsubscribe();
    window.removeEventListener("focus", onFocus);
  });

  const run = (action: () => Promise<GitHubConnectorStatus | undefined>, waits = true) => {
    if (waits && busy()) return;
    if (waits) setBusy(true);
    void action()
      .then((next) => {
        if (next && !disposed) setStatus(next);
      })
      .catch((error: unknown) => {
        const { t, errorMessage } = currentText();
        actionToast.error(t("connector.github.actionFailed"), {
          ...{
            description: errorMessage(error, t("connector.github.actionFailed")),
          },
          report: { operation: "other", source: "action", cause_code: classifyFailure(error) },
        });
      })
      .finally(() => {
        if (waits && !disposed) setBusy(false);
      });
  };

  return {
    status,
    busy,
    repositories,
    repositoriesError,
    reload,
    connect: () => run(() => port().connect()),
    cancel: () => run(() => port().cancel(), false),
    disconnect: () => run(() => port().disconnect()),
    openVerification: () => run(async () => void (await port().openVerification())),
    openInstall: () =>
      run(async () => {
        awaitingInstall = true;
        await port().openInstall();
      }),
  };
}

/** The panel of the connector. Server settings and the Marketplace show the same controller through it. */
export function githubPanelProps(controller: GitHubConnectorController): GitHubConnectorPanelProps {
  return {
    get status() {
      return controller.status();
    },
    get busy() {
      return controller.busy();
    },
    get repositories() {
      return controller.repositories();
    },
    get repositoriesError() {
      return controller.repositoriesError();
    },
    onConnect: controller.connect,
    onCancel: controller.cancel,
    onDisconnect: controller.disconnect,
    onOpenVerification: controller.openVerification,
    onOpenInstall: controller.openInstall,
  };
}
