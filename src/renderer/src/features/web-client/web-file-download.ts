import { base64ToBytes } from "@openbot/team-client/base64";
import { onCleanup } from "solid-js";

/**
 * Saves a file that the host sent, with a link click. The object URLs stay valid until the owner
 * is disposed, because a browser can read the file after the click returns.
 */
export function createWebFileSaver(): (file: { name: string; base64: string }) => void {
  const urls = new Set<string>();
  onCleanup(() => {
    for (const url of urls) URL.revokeObjectURL(url);
  });
  return (file) => {
    const url = URL.createObjectURL(new Blob([base64ToBytes(file.base64)], { type: "application/octet-stream" }));
    urls.add(url);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
  };
}
