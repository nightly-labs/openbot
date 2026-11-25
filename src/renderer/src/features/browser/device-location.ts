import type { BrowserLocation, BrowserPermissionAnswer, OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { BROWSER_LOCATION_ACCURACY_LIMIT } from "@openbot/contracts/team-protocol/browser-permissions-v1";

const LOCATION_TIMEOUT_MS = 20_000;
const LOCATION_MAX_AGE_MS = 60_000;

function accuracyOf(accuracy: number): number | null {
  return Number.isFinite(accuracy) && accuracy >= 0 ? Math.min(accuracy, BROWSER_LOCATION_ACCURACY_LIMIT) : null;
}

export function readDeviceLocation(): Promise<BrowserLocation> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Location is not available on this device."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) =>
        resolve({
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracyMeters: accuracyOf(coords.accuracy),
        }),
      (error) => reject(new Error(error.message)),
      { enableHighAccuracy: false, maximumAge: LOCATION_MAX_AGE_MS, timeout: LOCATION_TIMEOUT_MS },
    );
  });
}

export type LocationAnswerResult = "answered" | "unavailable";

export async function answerLocationRequest(
  browser: Pick<OpenBotDesktopApi["browser"], "answerPermission">,
  remote: boolean,
  answer: Omit<BrowserPermissionAnswer, "location">,
): Promise<LocationAnswerResult> {
  if (!answer.allow || !remote) {
    await browser.answerPermission(answer);
    return "answered";
  }
  const location = await readDeviceLocation().catch(() => null);
  await browser.answerPermission(
    location ? { ...answer, location } : { tabId: answer.tabId, requestId: answer.requestId, allow: false },
  );
  return location ? "answered" : "unavailable";
}
