import { type NativeModule, requireOptionalNativeModule } from "expo";
import { AppState } from "react-native";

export interface AwayState {
  awayMs: number | null;
  phoneLocked: boolean;
}

declare class AppLockModule extends NativeModule {
  configure(enabled: boolean, watchPhoneLock: boolean): Promise<void>;
  takeAway(): Promise<AwayState>;
  derivePin(pin: string, saltHex: string, iterations: number): Promise<string>;
}

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

export async function takeAwayState(): Promise<AwayState> {
  if (native) {
    const state = await native.takeAway();
    return { awayMs: state.awayMs ?? null, phoneLocked: state.phoneLocked === true };
  }
  const since = fallbackAwaySince;
  fallbackAwaySince = null;
  if (since === null) return { awayMs: null, phoneLocked: false };
  const awayMs = Date.now() - since;
  return { awayMs: awayMs < 0 ? Number.POSITIVE_INFINITY : awayMs, phoneLocked: false };
}

export const nativeDerivePin: ((pin: string, saltHex: string, iterations: number) => Promise<string>) | null =
  typeof native?.derivePin === "function"
    ? (pin, saltHex, iterations) => native.derivePin(pin, saltHex, iterations)
    : null;
