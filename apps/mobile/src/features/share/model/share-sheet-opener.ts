import { isAndroid } from "@/shared/lib/platform";

let open: (() => void) | null = null;
let pending = false;
/**
 * Android: true from a request until the sheet takes the share. The link of a share, the launch and
 * the return to the app can all ask for the sheet, and one share opens one sheet.
 */
let requested = false;
/**
 * Android: true while the route `/incoming-share` comes or shows. The sheet opens after that route
 * goes, so that the push of the sheet always goes into the signed-in stack, never over that route.
 */
let held = false;
/** Android: the open sheet, which takes a new share in place of a second sheet. */
let takeInOpenSheet: (() => void) | null = null;

function flush(): void {
  if (!pending || !open || held) return;
  pending = false;
  open();
}

/**
 * Opens the share sheet over the chat list. When a share starts the app, the signed-in stack mounts
 * only after this request. Android shows a sheet that the stack mounts with its first screen at full
 * height, with the header under the status bar. So the request waits until the stack has mounted.
 */
export function openShareSheet(): void {
  if (isAndroid) {
    if (requested) return;
    requested = true;
    // A second sheet would delete the files of the first one when it reads its share.
    if (takeInOpenSheet) {
      takeInOpenSheet();
      return;
    }
  }
  pending = true;
  flush();
}

/**
 * Ends an Android request: the sheet has taken the share, or the app went to the background before
 * the sheet opened, as while the app lock waits. The next request opens a sheet again.
 */
export function endShareSheetRequest(): void {
  requested = false;
}

/** Android: the link of a share opens `/incoming-share`. The sheet waits until that route goes. */
export function holdShareSheet(): void {
  if (isAndroid) held = true;
}

/** Android: `/incoming-share` has gone, or the app went to the background. A waiting sheet opens. */
export function releaseShareSheet(): void {
  held = false;
  flush();
}

/** Android: the open sheet takes the next share itself. */
export function setOpenShareSheet(take: () => void): () => void {
  takeInOpenSheet = take;
  return () => {
    if (takeInOpenSheet === take) takeInOpenSheet = null;
  };
}

/** The signed-in stack opens the share sheet. A request that came before opens now. */
export function setShareSheetOpener(next: () => void): () => void {
  open = next;
  flush();
  return () => {
    if (open === next) open = null;
  };
}
