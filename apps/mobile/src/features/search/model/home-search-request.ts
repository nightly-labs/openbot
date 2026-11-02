let opener: (() => void) | null = null;
let pending = false;
/** Home is ready but shows no search field, such as with no agents or during onboarding. */
let unavailable = false;

/**
 * Opens the search of the home screen from outside it, such as from a quick action of the app icon.
 * A request that comes before the field shows waits for it. A request while home is ready without
 * the field is dropped, so the field does not take the keyboard later with no request.
 */
export function requestHomeSearch(): void {
  if (opener) opener();
  else if (!unavailable) pending = true;
}

/** Home says when it is ready without a search field. A waiting request is dropped then. */
export function setHomeSearchUnavailable(next: boolean): void {
  unavailable = next;
  if (next) pending = false;
}

/** The home screen registers how it opens its search, and `null` when it unmounts. */
export function setHomeSearchOpener(open: (() => void) | null): void {
  opener = open;
  if (!open || !pending) return;
  pending = false;
  open();
}
