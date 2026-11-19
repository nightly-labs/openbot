import { base64ToBytes } from "@openbot/team-client/base64";
import { onCleanup } from "solid-js";

/**
 * Saves a file that the host sent, with a link click. The object URLs stay valid until the owner
 * is disposed, because a browser can read the file after the click returns.
 */
export function createWebFileSaver(): (file: { name: string; base64: string } | { name: string; blob: Blob }) => void {
  const urls = new Set<string>();
  onCleanup(() => {
    for (const url of urls) URL.revokeObjectURL(url);
  });
  return (file) => {
    // A large file comes as a Blob of its parts, so it is not one Base64 string in memory.
    const blob =
      "blob" in file ? file.blob : new Blob([base64ToBytes(file.base64)], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    urls.add(url);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
  };
}
