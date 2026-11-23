import { AppState, Keyboard } from "react-native";
import { create } from "zustand";
import { supportLog, supportLogValue } from "@/features/support/model/support-log";
import { type AwayState, configureAppLockSignals, takeAwayState } from "./app-lock-native";
import {
  type AppLockConfig,
  appLockEnabled,
  checkPin,
  DEFAULT_APP_LOCK_CONFIG,
  type PinAttempts,
  readAppLockConfig,
  readPinAttempts,
  writeAppLockConfig,
  writePin,
  writePinAttempts,
} from "./app-lock-storage";
import { authenticateWithDevice, type DeviceUnlockResult } from "./device-unlock";

const FREE_FAILURES = 4;
const FAILURE_DELAYS_MS = [30_000, 60_000, 300_000, 900_000, 3_600_000] as const;
export const MAX_PIN_FAILURES = 10;
const OWNER_CONFIRMATION_MS = 5 * 60_000;

interface AppLockState {
  status: "loading" | "ready" | "failed";
  config: AppLockConfig;
  locked: boolean;
  confirming: boolean;
  covered: boolean;
  lockCount: number;
  attempts: PinAttempts;
}

export const useAppLock = create<AppLockState>(() => ({
  status: "loading",
  config: DEFAULT_APP_LOCK_CONFIG,
  locked: false,
  confirming: false,
  covered: false,
  lockCount: 0,
  attempts: { failures: 0, lastFailureAt: 0 },
}));

let installed = false;
let ownerConfirmedUntil = 0;
let pendingConfirmation: ((confirmed: boolean) => void) | null = null;
let heldNavigation: (() => void) | null = null;
let deviceAuthentications = 0;
let awayDuringAuthentication: AwayState | null = null;

function appLockBlocks(state: AppLockState = useAppLock.getState()): boolean {
  return state.status !== "ready" || (appLockEnabled(state.config) && state.locked && !state.confirming);
}

function lock(): void {
  Keyboard.dismiss();
  ownerConfirmedUntil = 0;
  resolveConfirmation(false);
  useAppLock.setState((state) => ({ locked: true, confirming: false, lockCount: state.lockCount + 1 }));
}

function unlock(): void {
  useAppLock.setState({ locked: false, confirming: false, covered: false });
  ownerConfirmedUntil = Date.now() + OWNER_CONFIRMATION_MS;
  resolveConfirmation(true);
  releaseHeldNavigation();
}

function releaseHeldNavigation(): void {
  if (appLockBlocks()) return;
  const held = heldNavigation;
  heldNavigation = null;
  held?.();
}

function resolveConfirmation(confirmed: boolean): void {
  const resolve = pendingConfirmation;
  pendingConfirmation = null;
  resolve?.(confirmed);
}

function mergeAway(left: AwayState | null, right: AwayState): AwayState {
  if (!left) return right;
  return {
    awayMs: left.awayMs === null ? right.awayMs : Math.max(left.awayMs, right.awayMs ?? 0),
    phoneLocked: left.phoneLocked || right.phoneLocked,
  };
}

function mustLock(away: AwayState, state: AppLockState): boolean {
  if (!appLockEnabled(state.config) || (state.locked && !state.confirming)) return false;
  if (away.phoneLocked && state.config.lockWithPhone) return true;
  return away.awayMs !== null && away.awayMs >= state.config.lockAfterMs;
}

async function checkAway(): Promise<void> {
  let away: AwayState;
  try {
    away = await takeAwayState();
  } catch (error) {
    supportLog.add("warn", "app", `App lock could not read the time away: ${supportLogValue(error)}`);
    away = { awayMs: Number.POSITIVE_INFINITY, phoneLocked: true };
  }
  const state = useAppLock.getState();
  if (deviceAuthentications > 0) {
    awayDuringAuthentication = mergeAway(awayDuringAuthentication, away);
    useAppLock.setState({ covered: false });
    return;
  }
  if (state.status === "ready" && mustLock(away, state)) lock();
  useAppLock.setState({ covered: false });
}

async function load(): Promise<void> {
  try {
    const [config, attempts] = await Promise.all([readAppLockConfig(), readPinAttempts().catch(() => null)]);
    const enabled = appLockEnabled(config);
    const first = useAppLock.getState().status !== "ready";
    useAppLock.setState((state) => ({
      status: "ready",
      config,
      attempts: attempts ?? state.attempts,
      ...(first && enabled && { locked: true, lockCount: state.lockCount + 1 }),
    }));
    releaseHeldNavigation();
    await configureAppLockSignals(enabled, config.lockWithPhone).catch(() => undefined);
  } catch (error) {
    supportLog.add("warn", "app", `App lock settings not read: ${supportLogValue(error)}`);
    if (useAppLock.getState().status !== "ready") useAppLock.setState({ status: "failed" });
  }
}

export function installAppLock(): void {
  if (installed) return;
  installed = true;
  void load();
  AppState.addEventListener("change", (next) => {
    const state = useAppLock.getState();
    if (next !== "active") {
      if (state.status === "ready" && appLockEnabled(state.config)) useAppLock.setState({ covered: true });
      return;
    }
    if (state.status === "failed") void load();
    void checkAway();
  });
}

export function retryAppLockLoad(): Promise<void> {
  return load();
}

export function whenUnlocked(action: () => void): void {
  if (!appLockBlocks()) {
    action();
    return;
  }
  heldNavigation = action;
}

export function unlockAfterSignIn(): void {
  if (useAppLock.getState().status === "ready") unlock();
}

function blockedUntil(attempts: PinAttempts): number | null {
  if (attempts.failures <= FREE_FAILURES) return null;
  const delay = FAILURE_DELAYS_MS[attempts.failures - FREE_FAILURES - 1] ?? FAILURE_DELAYS_MS[4];
  return attempts.lastFailureAt + delay;
}

export function pinBlockedUntil(attempts: PinAttempts, now = Date.now()): number | null {
  if (attempts.failures > FREE_FAILURES && now < attempts.lastFailureAt) return now + FAILURE_DELAYS_MS[0];
  const until = blockedUntil(attempts);
  return until !== null && until > now ? until : null;
}

export type PinUnlockResult = "unlocked" | "wrong" | "blocked" | "tooManyAttempts" | "unavailable" | "failed";

export async function unlockWithPin(pin: string): Promise<PinUnlockResult> {
  const { config } = useAppLock.getState();
  if (!config.pin) return "unavailable";
  let attempts: PinAttempts;
  try {
    attempts = await readPinAttempts();
  } catch {
    return "failed";
  }
  useAppLock.setState({ attempts });
  const now = Date.now();
  if (attempts.failures >= MAX_PIN_FAILURES) return "tooManyAttempts";
  if (pinBlockedUntil(attempts, now) !== null) {
    if (now < attempts.lastFailureAt) {
      const restarted = { failures: attempts.failures, lastFailureAt: now };
      await writePinAttempts(restarted).catch(() => undefined);
      useAppLock.setState({ attempts: restarted });
    }
    return "blocked";
  }
  const counted = { failures: attempts.failures + 1, lastFailureAt: now };
  try {
    await writePinAttempts(counted);
  } catch {
    return "failed";
  }
  useAppLock.setState({ attempts: counted });
  let correct: boolean | null;
  try {
    correct = await checkPin(pin);
  } catch {
    return "failed";
  }
  if (correct === null) return "unavailable";
  if (!correct) return counted.failures >= MAX_PIN_FAILURES ? "tooManyAttempts" : "wrong";
  await resetAttempts();
  unlock();
  return "unlocked";
}

async function resetAttempts(): Promise<void> {
  const cleared = { failures: 0, lastFailureAt: 0 };
  useAppLock.setState({ attempts: cleared });
  await writePinAttempts(cleared).catch(() => undefined);
}

async function confirmWithDevice(promptMessage: string, cancelLabel: string): Promise<DeviceUnlockResult> {
  deviceAuthentications += 1;
  let result: DeviceUnlockResult = "failed";
  try {
    result = await authenticateWithDevice(promptMessage, cancelLabel);
  } finally {
    const away = mergeAway(
      awayDuringAuthentication,
      await takeAwayState().catch(() => ({ awayMs: null, phoneLocked: false })),
    );
    awayDuringAuthentication = null;
    deviceAuthentications -= 1;
    const state = useAppLock.getState();
    if (result !== "success" && mustLock(away, state)) lock();
  }
  return result;
}

export async function unlockWithDevice(promptMessage: string, cancelLabel: string): Promise<DeviceUnlockResult> {
  if (!useAppLock.getState().config.deviceUnlock) return "unavailable";
  const result = await confirmWithDevice(promptMessage, cancelLabel);
  if (result === "success") {
    await resetAttempts();
    unlock();
  }
  return result;
}

export function confirmOwner(): Promise<boolean> {
  const state = useAppLock.getState();
  if (!appLockEnabled(state.config) || Date.now() < ownerConfirmedUntil) return Promise.resolve(true);
  if (state.locked) return Promise.resolve(false);
  resolveConfirmation(false);
  return new Promise((resolve) => {
    pendingConfirmation = resolve;
    useAppLock.setState((current) => ({ confirming: true, locked: true, lockCount: current.lockCount + 1 }));
  });
}

export function cancelOwnerConfirmation(): void {
  if (!useAppLock.getState().confirming) return;
  useAppLock.setState({ confirming: false, locked: false });
  resolveConfirmation(false);
}

export function checkDeviceUnlock(promptMessage: string, cancelLabel: string): Promise<DeviceUnlockResult> {
  return confirmWithDevice(promptMessage, cancelLabel);
}

class OwnerNotConfirmedError extends Error {
  constructor() {
    super("The owner did not confirm the app lock change.");
  }
}

async function saveConfig(next: AppLockConfig): Promise<void> {
  const current = useAppLock.getState();
  if (current.status !== "ready") throw new OwnerNotConfirmedError();
  if (appLockEnabled(current.config) && Date.now() >= ownerConfirmedUntil) throw new OwnerNotConfirmedError();
  await writeAppLockConfig(next);
  const enabled = appLockEnabled(next);
  useAppLock.setState({ config: next, ...(!enabled && { attempts: { failures: 0, lastFailureAt: 0 } }) });
  if (!appLockEnabled(current.config) && enabled) ownerConfirmedUntil = Date.now() + OWNER_CONFIRMATION_MS;
  await configureAppLockSignals(enabled, next.lockWithPhone).catch(() => undefined);
}

export function updateAppLockConfig(change: Partial<Omit<AppLockConfig, "pin">>): Promise<void> {
  return saveConfig({ ...useAppLock.getState().config, ...change });
}

export function turnOffAppLockPin(): Promise<void> {
  return saveConfig({ ...useAppLock.getState().config, pin: false });
}

export async function saveAppLockPin(pin: string): Promise<void> {
  const current = useAppLock.getState();
  if (appLockEnabled(current.config) && Date.now() >= ownerConfirmedUntil) throw new OwnerNotConfirmedError();
  await writePin(pin);
  await resetAttempts();
  await saveConfig({ ...current.config, pin: true });
}

export async function forgetAppLockAndSignOut(signOut: () => Promise<void>): Promise<void> {
  await signOut();
  await forgetAppLock();
}

async function forgetAppLock(): Promise<void> {
  useAppLock.setState({ config: DEFAULT_APP_LOCK_CONFIG, attempts: { failures: 0, lastFailureAt: 0 } });
  try {
    await writeAppLockConfig(DEFAULT_APP_LOCK_CONFIG);
  } catch (error) {
    supportLog.add("warn", "app", `App lock settings not deleted: ${supportLogValue(error)}`);
  }
  await configureAppLockSignals(false, false).catch(() => undefined);
  heldNavigation = null;
  ownerConfirmedUntil = 0;
  resolveConfirmation(false);
  useAppLock.setState({ status: "ready", locked: false, confirming: false, covered: false });
}
