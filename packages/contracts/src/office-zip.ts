import { unzipSync } from "fflate";

const MAX_ZIP_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_ZIP_EXPANDED_BYTES = 32 * 1024 * 1024;

export function unzipOfficeXml(bytes: Uint8Array, entry: RegExp) {
  let expandedBytes = 0;
  return unzipSync(bytes, {
    filter: (file) => {
      if (!entry.test(file.name)) return false;
      if (file.originalSize > MAX_ZIP_ENTRY_BYTES) {
        throw new Error("The file preview is too large to read safely.");
      }
      expandedBytes += file.originalSize;
      if (expandedBytes > MAX_ZIP_EXPANDED_BYTES) {
        throw new Error("The file preview is too large to read safely.");
      }
      return true;
    },
  });
}
