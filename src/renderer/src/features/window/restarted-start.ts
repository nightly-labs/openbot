const RESTARTED_QUERY = "restarted";

let restartedStart = readRestartedStart();

function readRestartedStart(): boolean {
  const url = new URL(window.location.href);
  if (url.searchParams.get(RESTARTED_QUERY) !== "1") return false;
  url.searchParams.delete(RESTARTED_QUERY);
  window.history.replaceState(window.history.state, "", url);
  return true;
}

export function startsAfterRestart(): boolean {
  return restartedStart;
}

export function finishRestartedStart(): void {
  restartedStart = false;
}
