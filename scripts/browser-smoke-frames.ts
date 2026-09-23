import type { WebContents } from "electron";

/**
 * Waits until a displayed tab has presented a frame at its viewport size. The browser process
 * hit-tests a mouse event against the frame a view last presented, and under xvfb a tab that just
 * opened or resized can have none yet: Chromium then drops the click with no pointer event at all.
 * A capture is read from that presented frame, so a capture the size of the page's viewport is the
 * state to wait for.
 */
export async function waitForPresentedFrame(contents: WebContents, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "no capture";
  while (Date.now() < deadline) {
    try {
      const viewport = String(await contents.executeJavaScript("innerWidth + 'x' + innerHeight"));
      const size = (await contents.capturePage()).getSize();
      last = `${size.width}x${size.height} for a ${viewport} viewport`;
      if (`${size.width}x${size.height}` === viewport) return;
    } catch (error) {
      // A view with no frame yet has no surface to copy.
      last = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${contents.getURL()} presented no frame at its viewport size: ${last}.`);
}
