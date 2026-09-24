/**
 * Reads the `filename*=UTF-8''` name from a host's `Content-Disposition` header. A missing name, or
 * one that is not valid percent-encoding, gives the fallback: a bad header from a host must not
 * fail a download that already has its bytes.
 */
export function contentDispositionFileName(disposition: string | null, fallback: string): string {
  const encodedName = disposition?.match(/filename\*=UTF-8''([^;]+)/iu)?.[1];
  if (!encodedName) return fallback;
  try {
    return decodeURIComponent(encodedName);
  } catch {
    return fallback;
  }
}
