import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import type { DeviceToolApp } from "@openbot/contracts/team-protocol/device-tools-v1";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

const key = "openbot.mobile.device-apps.v1";

/** `ask` prompts at the first use, `allow` never prompts for a read, and `deny` refuses without a prompt. */
export type DeviceAppAccess = "ask" | "allow" | "deny";

/** The apps with an operation that adds data. They ask before each add until the user chooses Always. */
export const WRITABLE_DEVICE_APPS = ["calendar", "reminders"] as const satisfies readonly DeviceToolApp[];
export type WritableDeviceApp = (typeof WRITABLE_DEVICE_APPS)[number];

interface StoredDeviceApps {
  access: Record<DeviceToolApp, DeviceAppAccess>;
  writeAlways: Record<WritableDeviceApp, boolean>;
}

const initial: StoredDeviceApps = {
  access: { calendar: "ask", reminders: "ask", contacts: "ask", location: "ask" },
  writeAlways: { calendar: false, reminders: false },
};

export const useDeviceAppsPreference = create<StoredDeviceApps & { ready: boolean }>(() => ({
  ...initial,
  ready: false,
}));

function accessOf(value: unknown): DeviceAppAccess {
  return value === "allow" || value === "deny" ? value : "ask";
}

/** A value that is missing or wrong stays at the safe default: the app asks. */
function decode(stored: string | null): StoredDeviceApps {
  if (!stored) return initial;
  try {
    const value = JSON.parse(stored);
    if (!isDynamicRecord(value)) return initial;
    const access = isDynamicRecord(value.access) ? value.access : {};
    const writeAlways = isDynamicRecord(value.writeAlways) ? value.writeAlways : {};
    return {
      access: {
        calendar: accessOf(access.calendar),
        reminders: accessOf(access.reminders),
        contacts: accessOf(access.contacts),
        location: accessOf(access.location),
      },
      writeAlways: { calendar: writeAlways.calendar === true, reminders: writeAlways.reminders === true },
    };
  } catch {
    return initial;
  }
}

let loading: Promise<void> | null = null;

/** Reads the saved choices once. A failed read keeps the defaults, so every app asks. */
export function loadDeviceAppsPreference(): Promise<void> {
  if (useDeviceAppsPreference.getState().ready) return Promise.resolve();
  loading ??= (async () => {
    try {
      const stored = decode(await SecureStore.getItemAsync(key));
      // A change made while the read ran, such as an Always choice, wins over the stored value.
      if (!useDeviceAppsPreference.getState().ready) useDeviceAppsPreference.setState(stored);
    } catch {
      // Keep the defaults.
    } finally {
      useDeviceAppsPreference.setState({ ready: true });
      loading = null;
    }
  })();
  return loading;
}

async function persist(): Promise<void> {
  const { access, writeAlways } = useDeviceAppsPreference.getState();
  await SecureStore.setItemAsync(key, JSON.stringify({ access, writeAlways }));
}

/** Applies the choice now, also when storage fails. The caller shows the failure and offers a retry. */
export async function saveDeviceAppAccess(app: DeviceToolApp, access: DeviceAppAccess): Promise<void> {
  await loadDeviceAppsPreference();
  useDeviceAppsPreference.setState((state) => ({ access: { ...state.access, [app]: access } }));
  await persist();
}

export async function saveDeviceAppWriteAlways(app: WritableDeviceApp, always: boolean): Promise<void> {
  await loadDeviceAppsPreference();
  useDeviceAppsPreference.setState((state) => ({ writeAlways: { ...state.writeAlways, [app]: always } }));
  await persist();
}
