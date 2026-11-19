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

export interface GitHubConnectorController extends ConnectorController {
  readonly detail: { id: "github"; props: GitHubConnectorPanelProps };
}

export function createGitHubConnector(
  port: () => GitHubConnectorPort = githubConnectorPort,
  hostName: () => string | undefined = () => undefined,
): GitHubConnectorController {
  const [status, setStatus] = createSignal<GitHubConnectorStatus>(DISCONNECTED_GITHUB_CONNECTOR);
  const [repositories, setRepositories] = createSignal<GitHubConnectorRepositories | null>(null);
  const [repositoriesError, setRepositoriesError] = createSignal<string | null>(null);
  const [read, setRead] = createSignal(false);
  const actions = createConnectorActions("connector.github.actionFailed", "github");
  let repositoriesRead = 0;
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
