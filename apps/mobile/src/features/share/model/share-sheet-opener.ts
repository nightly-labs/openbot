import { isAndroid } from "@/shared/lib/platform";

let open: (() => void) | null = null;
let pending = false;
/**
 * Android: true from a request until the sheet takes the share. The link of a share, the launch and
 * the return to the app can all ask for the sheet, and one share opens one sheet.
 */
let requested = false;

/**
 * Opens the share sheet over the chat list. When a share starts the app, the signed-in stack mounts
 * only after this request. Android shows a sheet that the stack mounts with its first screen at full
 * height, with the header under the status bar. So the request waits until the stack has mounted.
 */
export function openShareSheet(): void {
  if (isAndroid) {
    if (requested) return;
    requested = true;
  }
  if (open) open();
  else pending = true;
}

/**
 * Ends an Android request: the sheet has taken the share, or the app went to the background before
 * the sheet opened, as while the app lock waits. The next request opens a sheet again.
 */
export function endShareSheetRequest(): void {
  requested = false;
}

/** The signed-in stack opens the share sheet. A request that came before opens now. */
export function setShareSheetOpener(next: () => void): () => void {
  open = next;
  if (pending) {
    pending = false;
    next();
  }
  return () => {
    if (open === next) open = null;
  };
}
