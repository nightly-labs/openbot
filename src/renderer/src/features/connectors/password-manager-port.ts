import type {
  OpenBotDesktopApi,
  PasswordManagerConnectInput,
  PasswordManagerId,
  PasswordManagerStatus,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";

type DesktopPasswordManagers = OpenBotDesktopApi["passwordManagers"];

/**
 * What a password manager page reaches: the managers of one place, this computer or a joined server.
 * One port serves every manager, because the engine gives them all the same status.
 */
export type PasswordManagerPort = Pick<
  DesktopPasswordManagers,
  "list" | "connect" | "cancel" | "disconnect" | "openSignIn" | "onChanged"
>;

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function passwordManagerPort(): PasswordManagerPort {
  const api = () => window.openbot.passwordManagers;
  return {
    list: () => api().list(),
    connect: (input) => api().connect(input),
    cancel: (manager) => api().cancel(manager),
    disconnect: (manager) => api().disconnect(manager),
    openSignIn: (manager) => api().openSignIn(manager),
    onChanged: (listener) => api().onChanged(listener),
  };
}

/** The actions of a joined server's managers (`password-managers-v1`). */
export type HostPasswordManagerActions = Omit<PasswordManagerPort, "onChanged">;

/** How often a joined server's managers are read while a sign-in runs. */
const HOST_POLL_MS = 2_000;
/**
 * The first sign-in can download the manager's CLI, and the user signs in in the browser. After this
 * many reads (15 minutes), opening the page reads again.
 */
const HOST_POLL_LIMIT = 450;

const signingIn = (status: PasswordManagerStatus) => status.state === "signing-in";

/**
 * A port to a joined server's managers. The host sends no event, so `onChanged` reads the list while
 * a sign-in runs, and stops when no sign-in runs or after `HOST_POLL_LIMIT` reads. A failed read counts as a read.
 */
export function polledPasswordManagerPort(actions: HostPasswordManagerActions): PasswordManagerPort {
  const listeners = new Set<(status: PasswordManagerStatus) => void>();
  /** The sign-ins that run, by manager, from the last status of each. */
  const running = new Set<PasswordManagerId>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let reads = 0;
  const stop = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const schedule = () => {
    if (running.size === 0) {
      stop();
      reads = 0;
      return;
    }
    if (timer !== null || listeners.size === 0 || reads >= HOST_POLL_LIMIT) return;
    timer = setTimeout(() => {
      timer = null;
      reads += 1;
      void actions.list().then(seenAll, schedule);
    }, HOST_POLL_MS);
  };
  const note = (status: PasswordManagerStatus) => {
    if (signingIn(status)) running.add(status.manager);
    else running.delete(status.manager);
    for (const listener of listeners) listener(status);
  };
  const seen = (status: PasswordManagerStatus) => {
    note(status);
    schedule();
    return status;
  };
  const seenAll = (statuses: PasswordManagerStatus[]) => {
    running.clear();
    for (const status of statuses) note(status);
    schedule();
    return statuses;
  };
  return {
    list: async () => {
      reads = 0;
      return seenAll(await actions.list());
    },
    connect: async (input: PasswordManagerConnectInput) => {
      reads = 0;
      return seen(await actions.connect(input));
    },
    cancel: async (manager) => seen(await actions.cancel(manager)),
    disconnect: async (manager) => seen(await actions.disconnect(manager)),
    openSignIn: (manager) => actions.openSignIn(manager),
    onChanged: (listener) => {
      listeners.add(listener);
      schedule();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
  };
}

/** The managers of the joined server that `serverId` names, through main. Main opens the sign-in page. */
export function hostPasswordManagerPort(serverId: () => string | undefined): PasswordManagerPort {
  const server = () => {
    const id = serverId();
    if (!id) throw new Error(sourceText("error.team.connectorsUnsupported"));
    return id;
  };
  const api = () => window.openbot.passwordManagers;
  return polledPasswordManagerPort({
    list: async () => api().hostList(server()),
    connect: async (input) => api().hostConnect(input, server()),
    cancel: async (manager) => api().hostCancel(manager, server()),
    disconnect: async (manager) => api().hostDisconnect(manager, server()),
    openSignIn: async (manager) => api().hostOpenSignIn(manager, server()),
  });
}
