let opener: (() => void) | null = null;
let pending = false;
let unavailable = false;

export function requestHomeSearch(): void {
  if (opener) opener();
  else if (!unavailable) pending = true;
}

export function setHomeSearchUnavailable(next: boolean): void {
  unavailable = next;
  if (next) pending = false;
}

export function setHomeSearchOpener(open: (() => void) | null): void {
  opener = open;
  if (!open || !pending) return;
  pending = false;
  open();
}
