import type { StoredFileRow } from "@openbot/contracts/ipc";

const PREVIEW_PROTOCOLS: ReadonlySet<string> = new Set(["openbot-attachment:", "openbot-remote-attachment:"]);

export function smallPictureUrl(file: StoredFileRow): string | null {
  const source = file.previewUrl;
  if (!source || file.previewKind !== "image" || !URL.canParse(source)) return source;
  const url = new URL(source);
  if (!PREVIEW_PROTOCOLS.has(url.protocol)) return source;
  url.searchParams.set("preview", "1");
  return url.toString();
}
