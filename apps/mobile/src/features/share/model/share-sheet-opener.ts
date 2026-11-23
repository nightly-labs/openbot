import { isAndroid } from "@/shared/lib/platform";

let open: (() => void) | null = null;
let pending = false;
let requested = false;
let held = false;
let takeInOpenSheet: (() => void) | null = null;

function flush(): void {
  if (!pending || !open || held) return;
  pending = false;
  open();
}

export function openShareSheet(): void {
  if (isAndroid) {
    if (requested) return;
    requested = true;
    if (takeInOpenSheet) {
      takeInOpenSheet();
      return;
    }
  }
  pending = true;
  flush();
}

export function endShareSheetRequest(): void {
  requested = false;
}

export function holdShareSheet(): void {
  if (isAndroid) held = true;
}

export function releaseShareSheet(): void {
  held = false;
  flush();
}

export function setOpenShareSheet(take: () => void): () => void {
  takeInOpenSheet = take;
  return () => {
    if (takeInOpenSheet === take) takeInOpenSheet = null;
  };
}

export function setShareSheetOpener(next: () => void): () => void {
  open = next;
  flush();
  return () => {
    if (open === next) open = null;
  };
}
