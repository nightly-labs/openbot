import { isOneOf } from "./runtime-values";

/**
 * The size of the desktop interface, as a percent of the default: the zoom factor of the main
 * window. Settings and the zoom shortcuts move through these steps, which are the browser zoom
 * steps. The value crosses IPC and is saved as written, so remove a step only with a read that
 * maps the old value to a near step.
 */
export const APP_INTERFACE_SIZES = [67, 75, 80, 90, 100, 110, 125, 150, 175, 200] as const;
export type AppInterfaceSize = (typeof APP_INTERFACE_SIZES)[number];
export const DEFAULT_APP_INTERFACE_SIZE: AppInterfaceSize = 100;

/** The preference as it is stored and as it crosses IPC. */
export interface AppInterfaceSizePreference {
  percent: AppInterfaceSize;
}

export type SetAppInterfaceSizePreferenceInput = AppInterfaceSizePreference;

export function isAppInterfaceSize(value: unknown): value is AppInterfaceSize {
  return isOneOf(APP_INTERFACE_SIZES, value);
}
