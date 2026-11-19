import { isDynamicRecord, isOneOf, isString } from "./runtime-values";

export const PASSWORD_MANAGER_IDS = ["onepassword", "bitwarden", "protonpass"] as const;
export type PasswordManagerId = (typeof PASSWORD_MANAGER_IDS)[number];

export const PASSWORD_MANAGER_STATES = ["disconnected", "signing-in", "connected", "failed"] as const;
export type PasswordManagerState = (typeof PASSWORD_MANAGER_STATES)[number];

export const PASSWORD_MANAGER_STEPS = ["browser", "extra-password", "setup"] as const;
export type PasswordManagerStep = (typeof PASSWORD_MANAGER_STEPS)[number];

export const PASSWORD_MANAGER_METHODS = ["browser", "key"] as const;
export type PasswordManagerMethod = (typeof PASSWORD_MANAGER_METHODS)[number];

export const PASSWORD_MANAGER_ERROR_CODES = ["plan", "expired", "extra-password"] as const;
export type PasswordManagerErrorCode = (typeof PASSWORD_MANAGER_ERROR_CODES)[number];

export interface PasswordManagerStatus {
  manager: PasswordManagerId;
  state: PasswordManagerState;
  step: PasswordManagerStep | null;
  methods: PasswordManagerMethod[];
  signInUrl: string | null;
  vaultNames: string[];
  loginCount: number | null;
  expiresAt: number | null;
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

export function decodePasswordManagerStatuses(value: unknown): PasswordManagerStatus[] {
  if (!Array.isArray(value)) throw new Error("Invalid password manager list.");
  return value.flatMap((status) => decodePasswordManagerStatus(status) ?? []);
}

export function decodeHostPasswordManagerList(value: unknown): PasswordManagerStatus[] {
  if (!isDynamicRecord(value)) throw new Error("Invalid password manager list.");
  return decodePasswordManagerStatuses(value.managers);
}

export function decodeHostPasswordManagerStatus(value: unknown): PasswordManagerStatus {
  const status = decodePasswordManagerStatus(value);
  if (!status) throw new Error("Invalid password manager status.");
  return status;
}
