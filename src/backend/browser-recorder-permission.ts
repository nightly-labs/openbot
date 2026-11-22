export const RECORDER_ORIGIN = "https://recorder.openbot.invalid";

interface TabCaptureRequest {
  requestingUrl: string;
  securityOrigin?: string | undefined;
  mediaTypes?: readonly string[] | undefined;
}

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
