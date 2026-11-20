import type { StoredFileRow } from "@openbot/contracts/ipc";

const PREVIEW_PROTOCOLS: ReadonlySet<string> = new Set(["openbot-attachment:", "openbot-remote-attachment:"]);

let visits = 0;

export function createSmallPictureUrl(): (file: StoredFileRow) => string | null {
  visits += 1;
  const visit = String(visits);
  return (file) => {
    const source = file.previewUrl;
    if (!source || file.previewKind !== "image" || !URL.canParse(source)) return source;
    const url = new URL(source);
    if (!PREVIEW_PROTOCOLS.has(url.protocol)) return source;
    url.searchParams.set("preview", "1");
    url.searchParams.set("visit", visit);
    return url.toString();
  };
}
