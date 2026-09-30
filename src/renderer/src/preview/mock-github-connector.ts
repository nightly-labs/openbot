import {
  DISCONNECTED_GITHUB_CONNECTOR,
  type GitHubConnectorDesktopApi,
  type GitHubConnectorStatus,
} from "@openbot/contracts/ipc";

/** How long the mock waits for GitHub's code, and then for the user to type it on github.com. */
const MOCK_CODE_MS = 800;
const MOCK_SIGN_IN_MS = 4_000;

const DISCONNECTED: GitHubConnectorStatus = { ...DISCONNECTED_GITHUB_CONNECTOR, available: true };

/**
 * Starts disconnected. Connect waits for a code as the real one does, shows it, and after a few
 * seconds the preview is signed in.
 */
export function createMockGitHubConnector(): GitHubConnectorDesktopApi {
  let status = DISCONNECTED;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Each connect, cancel and disconnect replaces the sign-in that a connect waits for. */
  let attempt = 0;
  const listeners = new Set<(status: GitHubConnectorStatus) => void>();
  const set = (next: GitHubConnectorStatus): GitHubConnectorStatus => {
    status = next;
    for (const listener of listeners) listener({ ...status });
    return { ...status };
  };
  const stopTimer = () => {
    attempt += 1;
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return {
    status: async () => ({ ...status }),
    connect: async () => {
      stopTimer();
      const current = attempt;
      const waiting = set({ ...DISCONNECTED, state: "pending", login: status.login });
      await new Promise<void>((resolve) => setTimeout(resolve, MOCK_CODE_MS));
      if (current !== attempt) return { ...status };
      timer = setTimeout(() => {
        timer = null;
        set({ ...DISCONNECTED, state: "connected", login: "octocat" });
      }, MOCK_SIGN_IN_MS);
      return set({ ...waiting, userCode: "WDJB-MJHT", verificationUri: "https://github.com/login/device" });
    },
    cancel: async () => {
      stopTimer();
      return set(DISCONNECTED);
    },
    disconnect: async () => {
      stopTimer();
      return set(DISCONNECTED);
    },
    repositories: async () =>
      status.state === "connected"
        ? {
            repositories: [
              { fullName: "octocat/hello-world", private: false },
              { fullName: "octocat/private-notes", private: true },
            ],
            total: 2,
          }
        : { repositories: [], total: 0 },
    openVerification: async () => undefined,
    openInstall: async () => undefined,
    onChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
