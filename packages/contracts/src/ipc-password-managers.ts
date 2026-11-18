import { isDynamicRecord, isOneOf, isString } from "./runtime-values";

/**
 * The password managers that the shared engine connects. Each id is also its Marketplace app id
 * (`CONNECTOR_IDS`). 1Password and Bitwarden keep their own panels and contracts as well; the engine
 * gives every manager the same status, so a new manager needs a driver and a descriptor only.
 */
export const PASSWORD_MANAGER_IDS = ["onepassword", "bitwarden", "protonpass"] as const;
export type PasswordManagerId = (typeof PASSWORD_MANAGER_IDS)[number];

export const PASSWORD_MANAGER_STATES = ["disconnected", "signing-in", "connected", "failed"] as const;
export type PasswordManagerState = (typeof PASSWORD_MANAGER_STATES)[number];

/** The step of a `browser` connection while the state is `signing-in`. */
export const PASSWORD_MANAGER_STEPS = ["browser", "extra-password", "setup"] as const;
export type PasswordManagerStep = (typeof PASSWORD_MANAGER_STEPS)[number];

/** How the user can connect a manager: a sign-in that the host runs, or an access key that the user made. */
export const PASSWORD_MANAGER_METHODS = ["browser", "key"] as const;
export type PasswordManagerMethod = (typeof PASSWORD_MANAGER_METHODS)[number];

/**
 * Why the last connection failed, when the panel shows more than the sentence in `error`:
 * `plan` — the account's plan does not allow the manager's CLI;
 * `expired` — the host's access key expired, so the user connects again;
 * `extra-password` — the extra password was not correct, and the host asks again.
 */
export const PASSWORD_MANAGER_ERROR_CODES = ["plan", "expired", "extra-password"] as const;
export type PasswordManagerErrorCode = (typeof PASSWORD_MANAGER_ERROR_CODES)[number];

/** Only connection state crosses back to the renderer. Access keys and passwords are never returned. */
export interface PasswordManagerStatus {
  manager: PasswordManagerId;
  state: PasswordManagerState;
  step: PasswordManagerStep | null;
  methods: PasswordManagerMethod[];
  /** The page that the user opens to sign in, while the step is `browser`. */
  signInUrl: string | null;
  /** The vaults that the connection reads. */
  vaultNames: string[];
  /** The logins that the browser can fill, or null until the host has read them. */
  loginCount: number | null;
  /** Milliseconds since 1970, when the access ends; null when it does not end. */
  expiresAt: number | null;
  /** The last failure, as a sentence. */
  error: string | null;
  errorCode: PasswordManagerErrorCode | null;
}

export type PasswordManagerConnectMethod =
  | { kind: "browser" }
  | { kind: "key"; key: string }
  | { kind: "extra-password"; password: string };

export interface PasswordManagerConnectInput {
  manager: PasswordManagerId;
  method: PasswordManagerConnectMethod;
}

export function disconnectedPasswordManager(
  manager: PasswordManagerId,
  methods: PasswordManagerMethod[] = [],
): PasswordManagerStatus {
  return {
    manager,
    state: "disconnected",
    step: null,
    methods,
    signInUrl: null,
    vaultNames: [],
    loginCount: null,
    expiresAt: null,
    error: null,
    errorCode: null,
  };
}

export function isPasswordManagerId(value: unknown): value is PasswordManagerId {
  return isOneOf(PASSWORD_MANAGER_IDS, value);
}

function known<T extends string>(choices: readonly T[], value: unknown): T | null {
  return isOneOf(choices, value) ? value : null;
}

function nullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function nullableCount(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

/**
 * One status from main or from a host (`password-managers-v1`). Returns null for a manager that this
 * build does not know. A state that it does not know shows as not connected, and an unknown step,
 * method or error code is left out. Throws for a value that is not a status.
 */
export function decodePasswordManagerStatus(value: unknown): PasswordManagerStatus | null {
  if (
    !isDynamicRecord(value) ||
    !isString(value.manager) ||
    !isString(value.state) ||
    !nullableString(value.step) ||
    !Array.isArray(value.methods) ||
    !nullableString(value.signInUrl) ||
    !Array.isArray(value.vaultNames) ||
    !value.vaultNames.every(isString) ||
    !nullableCount(value.loginCount) ||
    !nullableCount(value.expiresAt) ||
    !nullableString(value.error) ||
    !nullableString(value.errorCode)
  ) {
    throw new Error("Invalid password manager status.");
  }
  if (!isPasswordManagerId(value.manager)) return null;
  const state = known(PASSWORD_MANAGER_STATES, value.state) ?? "disconnected";
  return {
    manager: value.manager,
    state,
    step: state === "signing-in" ? known(PASSWORD_MANAGER_STEPS, value.step) : null,
    methods: value.methods.flatMap((method) => known(PASSWORD_MANAGER_METHODS, method) ?? []),
    signInUrl: state === "signing-in" ? value.signInUrl : null,
    vaultNames: value.vaultNames,
    loginCount: value.loginCount,
    expiresAt: value.expiresAt,
    error: value.error,
    errorCode: known(PASSWORD_MANAGER_ERROR_CODES, value.errorCode),
  };
}

/** The managers of main or of a host, without those that this build does not know. Throws for a value that is not a list. */
export function decodePasswordManagerStatuses(value: unknown): PasswordManagerStatus[] {
  if (!Array.isArray(value)) throw new Error("Invalid password manager list.");
  return value.flatMap((status) => decodePasswordManagerStatus(status) ?? []);
}

/** The status of a host's `list` answer (`password-managers-v1`). */
export function decodeHostPasswordManagerList(value: unknown): PasswordManagerStatus[] {
  if (!isDynamicRecord(value)) throw new Error("Invalid password manager list.");
  return decodePasswordManagerStatuses(value.managers);
}

/** The status of one manager from a host. Throws when the host answers for a manager that this build does not know. */
export function decodeHostPasswordManagerStatus(value: unknown): PasswordManagerStatus {
  const status = decodePasswordManagerStatus(value);
  if (!status) throw new Error("Invalid password manager status.");
  return status;
}
