// The desktop choice to keep its remote server sessions between runs of the app.

/** As it is stored and as it crosses IPC. */
export interface RemoteSessionReusePreference {
  /** Keep each joined server's session for the next start, and leave it open at quit. */
  keepBetweenRuns: boolean;
}

export const DEFAULT_REMOTE_SESSION_REUSE_PREFERENCE: RemoteSessionReusePreference = { keepBetweenRuns: true };
