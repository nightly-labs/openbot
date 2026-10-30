import { type NativeModule, requireOptionalNativeModule } from "expo";
import { AppState } from "react-native";

export interface AwayState {
  /** The time since the app left the foreground, or null when it did not leave. */
  awayMs: number | null;
  /** True when the phone locked since the last read. */
  phoneLocked: boolean;
}

declare class AppLockModule extends NativeModule {
  configure(enabled: boolean, watchPhoneLock: boolean): Promise<void>;
  takeAway(): Promise<AwayState>;
  derivePin(pin: string, saltHex: string, iterations: number): Promise<string>;
}

/** `modules/app-lock`. A build without it, such as Expo Go, measures with the phone's clock and cannot see a phone lock. */
const native = requireOptionalNativeModule<AppLockModule>("OpenBotAppLock");

let fallbackAwaySince: number | null = null;
if (!native) {
  AppState.addEventListener("change", (state) => {
    if (state !== "active") fallbackAwaySince ??= Date.now();
  });
}

export function configureAppLockSignals(enabled: boolean, watchPhoneLock: boolean): Promise<void> {
  return native ? native.configure(enabled, watchPhoneLock) : Promise.resolve();
}

/** Returns the time away and the phone lock since the last read, and clears them. */
export async function takeAwayState(): Promise<AwayState> {
  if (native) {
    const state = await native.takeAway();
    return { awayMs: state.awayMs ?? null, phoneLocked: state.phoneLocked === true };
  }
  const since = fallbackAwaySince;
  fallbackAwaySince = null;
  if (since === null) return { awayMs: null, phoneLocked: false };
  const awayMs = Date.now() - since;
  // A phone clock that moved back gives a negative time. It counts as a long time away.
  return { awayMs: awayMs < 0 ? Number.POSITIVE_INFINITY : awayMs, phoneLocked: false };
}

/**
 * PBKDF2-HMAC-SHA256 in native code, as lowercase hex. Null in a build without it, such as Expo Go. A dev
 * build from before this function also has none.
 */
export const nativeDerivePin: ((pin: string, saltHex: string, iterations: number) => Promise<string>) | null =
  typeof native?.derivePin === "function"
    ? (pin, saltHex, iterations) => native.derivePin(pin, saltHex, iterations)
    : null;
