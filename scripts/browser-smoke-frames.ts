import type { NativeImage, WebContents } from "electron";

const CAPTURE_ATTEMPT_MS = 1_000;

/**
 * Waits until a displayed tab has presented a frame at its viewport size. The browser process
 * hit-tests a mouse event against the frame a view last presented, and under xvfb a tab that just
 * opened or resized can have none yet: Chromium then drops the click with no pointer event at all.
 * A capture is read from that presented frame, so a capture the size of the page's viewport is the
 * state to wait for.
 *
 * Each attempt forces a repaint and is given up after a second. A capture waits for the view's next
 * frame, and under xvfb a static page that was just shown or resized can have no damage left to
 * draw: the capture then hangs until Chromium gives up with UnknownVizError. A repaint issued before
 * the view can draw is lost, so one repaint is not enough; a new attempt repaints again.
 */
export async function waitForPresentedFrame(contents: WebContents, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  let last = "no capture";
  while (Date.now() < deadline) {
    attempts += 1;
    try {
      const viewport = String(await contents.executeJavaScript("innerWidth + 'x' + innerHeight"));
      contents.invalidate();
      const image = await captureWithin(contents, CAPTURE_ATTEMPT_MS);
      if (image) {
        const size = image.getSize();
        last = `${size.width}x${size.height} for a ${viewport} viewport`;
        if (`${size.width}x${size.height}` === viewport) return;
      } else {
        last = "the capture did not finish";
      }
    } catch (error) {
      // A view with no frame yet has no surface to copy.
      last = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${contents.getURL()} presented no frame at its viewport size after ${attempts} attempts: ${last}.`);
}

/** Resolves with the capture, or with null when it does not finish in time. */
async function captureWithin(contents: WebContents, timeoutMs: number): Promise<NativeImage | null> {
  const capture = contents.capturePage();
  // A capture given up on still settles later, and its rejection is not an error of this wait.
  capture.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([capture, expired]);
  } finally {
    clearTimeout(timer);
  }
}
