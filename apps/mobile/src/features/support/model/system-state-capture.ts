import { Camera } from "expo-camera";
import { Paths } from "expo-file-system";
import * as Notifications from "expo-notifications";
import { AppState } from "react-native";
import { speechRecognition } from "@/shared/lib/speech-recognition";
import { supportLog } from "./support-log";

/** One low memory warning in this time goes to the log. The system can send many in a row. */
const MEMORY_WARNING_GAP_MS = 60_000;
const GB = 1024 ** 3;

let installed = false;
let last = "";
let lastMemoryWarning = 0;

type Permission = "granted" | "denied" | "not asked" | "not known";

function permissionOf(response: { granted: boolean; canAskAgain?: boolean; status?: string }): Permission {
  if (response.granted) return "granted";
  return response.status === "undetermined" ? "not asked" : "denied";
}

async function read(probe: (() => Promise<{ granted: boolean; status?: string }>) | undefined): Promise<Permission> {
  if (!probe) return "not known";
  try {
    return permissionOf(await probe());
  } catch {
    return "not known";
  }
}

/** A range, not a number: the free space of a phone changes all the time, and the range is what support needs. */
function freeStorage() {
  try {
    const free = Paths.availableDiskSpace;
    if (free < 0.5 * GB) return "under 0.5 GB";
    if (free < 2 * GB) return "0.5-2 GB";
    if (free < 10 * GB) return "2-10 GB";
    return "over 10 GB";
  } catch {
    return "not known";
  }
}

/**
 * The state of the phone that explains many reports: a permission that the user turned off in the
 * phone settings, or a phone with almost no free storage. It goes to the support log when it changes.
 * Only fixed words, never a value of the user.
 */
async function logState(): Promise<void> {
  // A local name keeps the null check inside the function.
  const speech = speechRecognition;
  const [notifications, microphone, camera] = await Promise.all([
    read(() => Notifications.getPermissionsAsync()),
    read(speech ? () => speech.getMicrophonePermissionsAsync() : undefined),
    read(() => Camera.getCameraPermissionsAsync()),
  ]);
  const text = `System: notifications ${notifications}, microphone ${microphone}, camera ${camera}, free storage ${freeStorage()}`;
  if (text === last) return;
  last = text;
  supportLog.add(notifications === "denied" ? "warn" : "info", "app", text);
}

/** Reads the state after the first screen and at each return to the app, and logs low memory warnings. */
export function installSystemState(): void {
  if (installed) return;
  installed = true;
  requestIdleCallback(() => void logState().catch(() => undefined));
  AppState.addEventListener("change", (state) => {
    if (state === "active") void logState().catch(() => undefined);
  });
  AppState.addEventListener("memoryWarning", () => {
    const now = Date.now();
    if (now - lastMemoryWarning < MEMORY_WARNING_GAP_MS) return;
    lastMemoryWarning = now;
    supportLog.add("warn", "app", "Low memory warning from the system");
  });
}
