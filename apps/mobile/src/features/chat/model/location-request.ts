import {
  SHARED_LOCATION_ACCURACY_LIMIT,
  type SharedLocation,
} from "@openbot/contracts/team-protocol/ui-block-location-v1";
import type { ConversationUiBlock } from "@openbot/contracts/ui-blocks";
import * as Location from "expo-location";

const LAST_KNOWN_MAX_AGE = 2 * 60_000;
const LAST_KNOWN_ACCURACY = 1_000;
const FIX_TIMEOUT = 10_000;

export type LocationReading =
  | { status: "found"; location: SharedLocation }
  | { status: "blocked" | "denied" | "unavailable" };

export function isLocationRequest(block: ConversationUiBlock | undefined): boolean {
  return block?.location === true && block.spec.type === "form";
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function foregroundPermission(): Promise<"granted" | "blocked" | "denied"> {
  const current = await Location.getForegroundPermissionsAsync();
  if (current.granted) return "granted";
  if (!current.canAskAgain) return "blocked";
  const asked = await Location.requestForegroundPermissionsAsync();
  if (asked.granted) return "granted";
  return asked.canAskAgain ? "denied" : "blocked";
}

export async function readCurrentLocation(): Promise<LocationReading> {
  const permission = await foregroundPermission();
  if (permission !== "granted") return { status: permission };
  const fix =
    (await Location.getLastKnownPositionAsync({
      maxAge: LAST_KNOWN_MAX_AGE,
      requiredAccuracy: LAST_KNOWN_ACCURACY,
    }).catch(() => null)) ??
    (await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null),
      FIX_TIMEOUT,
    ));
  if (!fix) return { status: "unavailable" };
  const accuracy = fix.coords.accuracy;
  return {
    status: "found",
    location: {
      latitude: fix.coords.latitude,
      longitude: fix.coords.longitude,
      accuracyMeters:
        accuracy !== null && Number.isFinite(accuracy) && accuracy >= 0
          ? Math.min(accuracy, SHARED_LOCATION_ACCURACY_LIMIT)
          : null,
      capturedAt: new Date(fix.timestamp).toISOString(),
    },
  };
}
