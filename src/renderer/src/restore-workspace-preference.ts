const RESTORE_LAST_WORKSPACE_STORAGE_KEY = "openbot:restore-last-workspace";

export function readRestoreLastWorkspace(): boolean {
  try {
    return window.localStorage.getItem(RESTORE_LAST_WORKSPACE_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function writeRestoreLastWorkspace(restore: boolean): void {
  try {
    window.localStorage.setItem(RESTORE_LAST_WORKSPACE_STORAGE_KEY, String(restore));
  } catch {}
}
