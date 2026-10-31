import {
  DISCONNECTED_GITHUB_CONNECTOR,
  type GitHubConnectorRepositories,
  type GitHubConnectorStatus,
} from "@openbot/contracts/ipc";
import type { GitHubConnectorPanelProps } from "@openbot/ui/features/settings/GitHubConnectorPanel";
import { currentText } from "@openbot/ui/text";
import { createEffect, createSignal, onCleanup, onSettled } from "solid-js";
import {
  type ConnectorAnalyticsAction,
  type ConnectorController,
  createConnectorActions,
  NO_WATCH,
} from "./connector-controller";
import { type GitHubConnectorPort, githubConnectorPort } from "./github-connector-port";

/** A controller whose page is the GitHub page, for a view that shows a part of it. */
export interface GitHubConnectorController extends ConnectorController {
  readonly detail: { id: "github"; props: GitHubConnectorPanelProps };
}

/**
 * The GitHub connection of this computer or of a joined server. Reads the status once and then
 * follows the port's `changed` event, because the sign-in finishes in the browser, outside this
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
  /** The joined server whose connection this is, or undefined for this computer's. */
  hostName: () => string | undefined = () => undefined,
): GitHubConnectorController {
  const [status, setStatus] = createSignal<GitHubConnectorStatus>(DISCONNECTED_GITHUB_CONNECTOR);
  const [repositories, setRepositories] = createSignal<GitHubConnectorRepositories | null>(null);
  const [repositoriesError, setRepositoriesError] = createSignal<string | null>(null);
  /** False until the first status read ends. Until then, `available` is not known. */
  const [read, setRead] = createSignal(false);
  const actions = createConnectorActions("connector.github.actionFailed", "github");
  /** Each read replaces the one before it, so a slow answer never overwrites a newer one. */
  let repositoriesRead = 0;
  /** Set when GitHub opened to change the repositories. The next window focus reads them again. */
  let awaitingInstall = false;

  const readRepositories = () => {
    const read = ++repositoriesRead;
    void port()
      .repositories()
      .then((next) => {
        if (actions.disposed() || read !== repositoriesRead) return;
        setRepositories(next);
        setRepositoriesError(null);
      })
      .catch((error: unknown) => {
        if (actions.disposed() || read !== repositoriesRead) return;
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
    if (!actions.disposed()) setStatus(next);
  });
  // A failed read keeps the last status. The next `reload` or `changed` event replaces it.
  const reload = () => {
    if (status().state === "connected") readRepositories();
    void port()
      .status()
      .then((next) => {
        if (!actions.disposed()) setStatus(next);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!actions.disposed()) setRead(true);
      });
  };
  onSettled(reload);
  onCleanup(() => {
    unsubscribe();
    window.removeEventListener("focus", onFocus);
  });

  const run = (
    action: () => Promise<GitHubConnectorStatus | undefined>,
    waits = true,
    track?: ConnectorAnalyticsAction,
  ) =>
    actions.run(action, {
      waits,
      ...(track ? { track } : {}),
      done: (next) => {
        if (next) setStatus(next);
      },
    });
  const connect = () => run(() => port().connect(), true, "connect_started");

  return {
    id: "github",
    ready: read,
    available: () => status().available,
    busy: actions.busy,
    connect,
    reload,
    watch: NO_WATCH,
    detail: {
      id: "github",
      props: {
        get hostName() {
          return hostName();
        },
        get status() {
          return status();
        },
        get busy() {
          return actions.busy();
        },
        get repositories() {
          return repositories();
        },
        get repositoriesError() {
          return repositoriesError();
        },
        onConnect: connect,
        onCancel: () => run(() => port().cancel(), false),
        onDisconnect: () => run(() => port().disconnect(), true, "disconnected"),
        onOpenVerification: () => run(async () => void (await port().openVerification())),
        onOpenInstall: () =>
          run(async () => {
            awaitingInstall = true;
            await port().openInstall();
          }),
      },
    },
  };
}
