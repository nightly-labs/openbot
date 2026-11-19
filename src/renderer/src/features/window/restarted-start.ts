let restartedStart = new URLSearchParams(window.location.search).get("restarted") === "1";

export function startsAfterRestart(): boolean {
  return restartedStart;
}

export function finishRestartedStart(): void {
  restartedStart = false;
}
