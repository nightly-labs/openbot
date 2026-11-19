import { isBoolean, isDynamicRecord, isNumber, isString } from "./runtime-values";

export type OnePasswordConnectorState = "disconnected" | "connecting" | "choose-account" | "connected";

function isOnePasswordConnectorState(value: unknown): value is OnePasswordConnectorState {
  return value === "disconnected" || value === "connecting" || value === "choose-account" || value === "connected";
}

export interface OnePasswordAccount {
  id: string;
  label: string;
}

export type OnePasswordCliState = "checking" | "missing" | "installing" | "ready";

function isOnePasswordCliState(value: unknown): value is OnePasswordCliState {
  return value === "checking" || value === "missing" || value === "installing" || value === "ready";
}

export interface OnePasswordSetup {
  cli: OnePasswordCliState;
  cliVersion: string | null;
  canInstall: boolean;
  appIntegration: boolean | null;
}

export interface OnePasswordConnectorStatus {
  state: OnePasswordConnectorState;
  setup: OnePasswordSetup;
  accounts: OnePasswordAccount[];
  vaultNames: string[];
  loginCount: number | null;
  error: string | null;
}

export const DISCONNECTED_ONEPASSWORD_CONNECTOR: OnePasswordConnectorStatus = {
  state: "disconnected",
  setup: { cli: "checking", cliVersion: null, canInstall: false, appIntegration: null },
  accounts: [],
  vaultNames: [],
  loginCount: null,
  error: null,
};

export interface OnePasswordConnectInput {
  accountId: string | null;
}

export interface OnePasswordHostConnectInput {
  token: string;
}

function parseOnePasswordAccount(value: unknown): OnePasswordAccount | null {
  if (!isDynamicRecord(value) || !isString(value.id) || !isString(value.label)) return null;
  return { id: value.id, label: value.label };
}

function parseOnePasswordSetup(value: unknown): OnePasswordSetup | null {
  if (
    !isDynamicRecord(value) ||
    !isOnePasswordCliState(value.cli) ||
    !(value.cliVersion === null || isString(value.cliVersion)) ||
    !isBoolean(value.canInstall) ||
    !(value.appIntegration === null || isBoolean(value.appIntegration))
  ) {
    return null;
  }
  return {
    cli: value.cli,
    cliVersion: value.cliVersion,
    canInstall: value.canInstall,
    appIntegration: value.appIntegration,
  };
}

export function parseOnePasswordConnectorStatus(value: unknown): OnePasswordConnectorStatus | null {
  const setup = isDynamicRecord(value) ? parseOnePasswordSetup(value.setup) : null;
  if (
    !setup ||
    !isDynamicRecord(value) ||
    !isOnePasswordConnectorState(value.state) ||
    !Array.isArray(value.accounts) ||
    !Array.isArray(value.vaultNames) ||
    !value.vaultNames.every(isString) ||
    !(value.loginCount === null || isNumber(value.loginCount)) ||
    !(value.error === null || isString(value.error))
  ) {
    return null;
  }
  const accounts: OnePasswordAccount[] = [];
  for (const item of value.accounts) {
    const account = parseOnePasswordAccount(item);
    if (!account) return null;
    accounts.push(account);
  }
  return {
    state: value.state,
    setup,
    accounts,
    vaultNames: [...value.vaultNames],
    loginCount: value.loginCount,
    error: value.error,
  };
}

export function decodeHostOnePasswordConnectorStatus(value: unknown): OnePasswordConnectorStatus {
  if (
    !isDynamicRecord(value) ||
    !isString(value.state) ||
    !Array.isArray(value.vaultNames) ||
    !value.vaultNames.every(isString) ||
    !(value.loginCount === null || isNumber(value.loginCount)) ||
    !(value.error === null || isString(value.error))
  ) {
    throw new Error("Invalid 1Password connector response.");
  }
  const state = value.state === "connecting" || value.state === "connected" ? value.state : "disconnected";
  return {
    ...DISCONNECTED_ONEPASSWORD_CONNECTOR,
    state,
    vaultNames: state === "connected" ? [...value.vaultNames] : [],
    loginCount: state === "connected" ? value.loginCount : null,
    error: value.error,
  };
}
