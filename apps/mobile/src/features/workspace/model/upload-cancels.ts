import type { RemoteFileUpload } from "@openbot/team-client/remote-peer";

const checks = new Map<string, () => boolean>();

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
