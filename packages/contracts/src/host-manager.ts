/** Local host-management protocol. Contains no tenant content or tenant-supplied paths. */
export interface HostManagerConfig {
  managed: boolean;
  tenants: number[];
}

export interface HostUpdateState {
  phase: "idle" | "downloading" | "waiting" | "stopping" | "installing" | "released" | "aborted" | "failed";
  cycle: string;
  version: string | null;
  updatedAt: number;
  error: string | null;
}

export interface HostTenantStatus {
  uid: number;
  pid: number;
  currentVersion: string;
  heartbeatAt: number;
  safeToRestart: boolean;
  /** Changes each time this process observes busy work, including between host polls. */
  idleSince: number | null;
  cycle: string;
  healthy: boolean;
}
