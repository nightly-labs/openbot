import type { WebContents } from "electron";

export async function waitForPresentedFrame(contents: WebContents, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "no capture";
  while (Date.now() < deadline) {
    try {
      const [width = 0, height = 0, ratio = 1] = String(
        await contents.executeJavaScript("[innerWidth, innerHeight, devicePixelRatio].join(' ')"),
      )
        .split(" ")
        .map(Number);
      const size = (await contents.capturePage()).getSize();
      last = `${size.width}x${size.height} for a ${width}x${height} viewport at ${ratio}x`;
      if (Math.abs(size.width - width * ratio) <= 1 && Math.abs(size.height - height * ratio) <= 1) return;
    } catch (error) {
      last = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${contents.getURL()} presented no frame at its viewport size: ${last}.`);
}
