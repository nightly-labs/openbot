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

/**
 * Shows a file in place and gives its name to a save from the page, such as the download button of
 * the PDF viewer. Without the name, the save names the file after the last part of the URL: the
 * attachment ID. A name that cannot be encoded gives only `inline`, so the file still shows.
 */
export function inlineContentDisposition(name: string): string {
  try {
    return name ? `inline; filename*=UTF-8''${encodeURIComponent(name)}` : "inline";
  } catch {
    return "inline";
  }
}
