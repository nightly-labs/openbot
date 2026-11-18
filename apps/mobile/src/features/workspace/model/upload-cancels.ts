import type { RemoteFileUpload } from "@openbot/team-client/remote-peer";

/**
 * The Cancel state of the device-file uploads in progress, by file ref. The transport reads it
 * before each part, so Cancel stops a large file in the middle, not only between files.
 */
const checks = new Map<string, () => boolean>();

/** Runs `upload` while the transport can see `cancelled` for its device file. */
export async function withUploadCancel<T>(
  input: RemoteFileUpload,
  cancelled: () => boolean,
  upload: () => Promise<T>,
): Promise<T> {
  const ref = input.file?.ref;
  if (!ref) return upload();
  checks.set(ref, cancelled);
  try {
    return await upload();
  } finally {
    if (checks.get(ref) === cancelled) checks.delete(ref);
  }
}

export function uploadCancelled(ref: string): boolean {
  return checks.get(ref)?.() === true;
}
