import type { DeviceToolResults } from "@openbot/contracts/team-protocol/device-tools-v1";
import * as Location from "expo-location";
import { DeviceToolError } from "./device-tool-error";
import { deviceIso } from "./device-values";

const LOCATION_TIMEOUT_MS = 15_000;
/** Three decimals of latitude are about 110 meters, so the accuracy cannot be better than this. */
const ROUNDED_ACCURACY_METERS = 100;

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** The position, rounded to three decimals here, so a finer value never leaves the phone. */
export async function currentLocation(): Promise<DeviceToolResults["location.current"]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const position = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.LocationAccuracy.Balanced }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DeviceToolError("device_error")), LOCATION_TIMEOUT_MS);
      }),
    ]);
    return {
      latitude: round3(position.coords.latitude),
      longitude: round3(position.coords.longitude),
      accuracy: Math.max(Math.round(position.coords.accuracy ?? 0), ROUNDED_ACCURACY_METERS),
      timestamp: deviceIso(new Date(position.timestamp)),
    };
  } finally {
    clearTimeout(timer);
  }
}
