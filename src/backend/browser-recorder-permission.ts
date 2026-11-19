/** The origin of the page that the recorder loads in its own hidden window. */
export const RECORDER_ORIGIN = "https://recorder.openbot.invalid";

/** The fields of an Electron permission request that the tab-capture decision reads. */
interface TabCaptureRequest {
  requestingUrl: string;
  securityOrigin?: string | undefined;
  mediaTypes?: readonly string[] | undefined;
}

/**
 * Electron asks the captured tab's session, not the recorder's, to allow a tab capture. A tab
 * session refuses `display-capture` for its pages, so it allows only the recorder's own request
 * for video while the recorder starts a capture of that tab.
 */
export function isRecorderTabCapture(
  permission: string,
  request: TabCaptureRequest,
  captureStarting: boolean,
): boolean {
  return (
    captureStarting &&
    permission === "display-capture" &&
    request.securityOrigin === `${RECORDER_ORIGIN}/` &&
    request.mediaTypes?.length === 1 &&
    request.mediaTypes[0] === "video"
  );
}
