import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { getRandomBytes } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { z } from "zod";
import { nativeDerivePin } from "@/features/app-lock/model/app-lock-native";
import * as LockedKeychain from "@/shared/lib/locked-keychain";

/**
 * The app lock settings. They hold no secret, and the app reads them also when iOS starts it in the
 * background, so they use the keychain items that open after the first unlock.
 */
const CONFIG_KEY = "openbot.mobile.app-lock.v1";
/** The PIN hash and the failed attempts. Only an unlocked phone opens them, and they stay on this device. */
const PIN_KEY = "openbot.mobile.app-lock.pin.v1";
const ATTEMPTS_KEY = "openbot.mobile.app-lock.attempts.v1";
const SECRET_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: "openbot.app-lock",
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const PIN_LENGTH = 4;
/**
 * A 4-digit PIN has 10,000 values, so no hash protects it from a person who can read the keychain.
 * The keychain and the attempt limit protect it. The slow hash only keeps the PIN out of plain sight.
 * Native code makes the hash in milliseconds. JavaScript takes seconds for the same rounds, so a build
 * without the native hash, such as Expo Go, uses fewer. Each stored hash keeps its own number of rounds.
 */
const PIN_ITERATIONS = nativeDerivePin ? 30_000 : 2_000;

export const LOCK_AFTER_OPTIONS_MS = [0, 60_000, 300_000, 900_000, 3_600_000] as const;

const configSchema = z.object({
  pin: z.boolean(),
  deviceUnlock: z.boolean(),
  lockAfterMs: z.number().int().nonnegative(),
  lockWithPhone: z.boolean(),
});
export type AppLockConfig = z.infer<typeof configSchema>;

export const DEFAULT_APP_LOCK_CONFIG: AppLockConfig = {
  pin: false,
  deviceUnlock: false,
  lockAfterMs: 60_000,
  lockWithPhone: true,
};

const pinSchema = z.object({
  salt: z.string().regex(/^[0-9a-f]{32}$/),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  iterations: z.number().int().positive(),
});

const attemptsSchema = z.object({
  failures: z.number().int().nonnegative(),
  lastFailureAt: z.number(),
});
export type PinAttempts = z.infer<typeof attemptsSchema>;

export function appLockEnabled(config: AppLockConfig): boolean {
  return config.pin || config.deviceUnlock;
}

/** Throws when the keychain is closed or the value is damaged. The caller keeps the app locked. */
export async function readAppLockConfig(): Promise<AppLockConfig> {
  const stored = await LockedKeychain.getItemAsync(CONFIG_KEY);
  return stored === null ? DEFAULT_APP_LOCK_CONFIG : configSchema.parse(JSON.parse(stored));
}

export async function writeAppLockConfig(config: AppLockConfig): Promise<void> {
  if (!appLockEnabled(config)) {
    await LockedKeychain.deleteItemAsync(CONFIG_KEY);
    await SecureStore.deleteItemAsync(PIN_KEY, SECRET_OPTIONS);
    await SecureStore.deleteItemAsync(ATTEMPTS_KEY, SECRET_OPTIONS);
    return;
  }
  await LockedKeychain.setItemAsync(CONFIG_KEY, JSON.stringify(config));
  if (!config.pin) await SecureStore.deleteItemAsync(PIN_KEY, SECRET_OPTIONS);
}

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  if (nativeDerivePin) return hexToBytes(await nativeDerivePin(pin, bytesToHex(salt), iterations));
  return pbkdf2Async(sha256, utf8ToBytes(pin), salt, { c: iterations, dkLen: 32 });
}

function isValidPin(pin: string): boolean {
  return new RegExp(`^[0-9]{${PIN_LENGTH}}$`).test(pin);
}

export async function writePin(pin: string): Promise<void> {
  if (!isValidPin(pin)) throw new Error("The PIN must have 4 digits.");
  const salt = getRandomBytes(16);
  const hash = await derive(pin, salt, PIN_ITERATIONS);
  const value = { salt: bytesToHex(salt), hash: bytesToHex(hash), iterations: PIN_ITERATIONS };
  await SecureStore.setItemAsync(PIN_KEY, JSON.stringify(value), SECRET_OPTIONS);
}

/** Returns null when the phone has no PIN for the app, such as after a restore to another phone. */
export async function checkPin(pin: string): Promise<boolean | null> {
  const stored = await SecureStore.getItemAsync(PIN_KEY, SECRET_OPTIONS);
  if (stored === null) return null;
  const { salt, hash, iterations } = pinSchema.parse(JSON.parse(stored));
  if (!isValidPin(pin)) return false;
  const expected = hexToBytes(hash);
  const actual = await derive(pin, hexToBytes(salt), iterations);
  let difference = expected.length ^ actual.length;
  for (let index = 0; index < expected.length; index += 1) difference |= (expected[index] ?? 0) ^ (actual[index] ?? 0);
  return difference === 0;
}

export async function readPinAttempts(): Promise<PinAttempts> {
  const stored = await SecureStore.getItemAsync(ATTEMPTS_KEY, SECRET_OPTIONS);
  return stored === null ? { failures: 0, lastFailureAt: 0 } : attemptsSchema.parse(JSON.parse(stored));
}

export async function writePinAttempts(attempts: PinAttempts): Promise<void> {
  if (attempts.failures === 0) await SecureStore.deleteItemAsync(ATTEMPTS_KEY, SECRET_OPTIONS);
  else await SecureStore.setItemAsync(ATTEMPTS_KEY, JSON.stringify(attempts), SECRET_OPTIONS);
}
