import { create } from "zustand";

/** Animation choices for this device. Each value is true when the animation plays. */
export interface MotionPreferences {
  /** Off reduces motion in the whole app, as the system Reduce Motion setting does. */
  allAnimations: boolean;
  /** The iOS zoom from a home row into its chat and back. */
  chatZoom: boolean;
  /** The faces that agent avatars make while they work and rest. */
  agentFaces: boolean;
  /** The message field shrinks to a small bar while the keyboard is closed. */
  composerResize: boolean;
  /** A reply types out and its new words fade in. */
  textReveal: boolean;
}

export type MotionPreference = keyof MotionPreferences;

const DEFAULTS: MotionPreferences = {
  allAnimations: true,
  chatZoom: true,
  agentFaces: true,
  composerResize: true,
  textReveal: true,
};
export const MOTION_PREFERENCE_NAMES: readonly MotionPreference[] = [
  "allAnimations",
  "chatZoom",
  "agentFaces",
  "composerResize",
  "textReveal",
];

export const useMotionPreferences = create<MotionPreferences & { ready: boolean }>(() => ({
  ...DEFAULTS,
  ready: false,
}));

/** Reads the stored value. A missing, damaged or older value keeps the default for each field it lacks. */
export function decodeMotionPreferences(stored: string | null): MotionPreferences {
  let value: unknown = null;
  try {
    value = stored === null ? null : JSON.parse(stored);
  } catch {
    value = null;
  }
  const fields = new Map<string, unknown>(typeof value === "object" && value !== null ? Object.entries(value) : []);
  const preferences = { ...DEFAULTS };
  for (const name of MOTION_PREFERENCE_NAMES) {
    const field = fields.get(name);
    if (typeof field === "boolean") preferences[name] = field;
  }
  return preferences;
}
