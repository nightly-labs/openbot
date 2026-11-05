// 1Password as a driver of the password-manager engine. The 1Password service keeps its own panel,
// IPC group, Team API routes, store and teardown; this adapter only shows its status in the shared
// form. It has no shared connect method: the 1Password panel connects it.

import type { OnePasswordConnectorStatus, PasswordManagerStatus } from "@openbot/contracts/ipc";
import { disconnectedPasswordManager } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { PASSWORD_MANAGER_BRANDS } from "../../backend/password-vault";
import type { OnePasswordConnectorService } from "../onepassword-connector-service";
import { type PasswordManagerDriver, PasswordManagerError, passwordManagerFailure } from "./driver";

function onePasswordStatus(status: OnePasswordConnectorStatus): PasswordManagerStatus {
  const base = disconnectedPasswordManager("onepassword");
  if (status.state === "connected") {
    return { ...base, state: "connected", vaultNames: status.vaultNames, loginCount: status.loginCount };
  }
  if (status.state === "connecting" || status.state === "choose-account") {
    return { ...base, state: "signing-in", step: "setup" };
  }
  return status.error ? { ...base, state: "failed", error: status.error } : base;
}

export function onePasswordDriver(service: OnePasswordConnectorService): PasswordManagerDriver {
  return {
    id: "onepassword",
    prefix: "",
    brand: PASSWORD_MANAGER_BRANDS.onepassword,
    signInHosts: [],
    vault: service,
    status: () => onePasswordStatus(service.status()),
    connect: () => Effect.fail(passwordManagerFailure(sourceText("error.connector.passwordManagerMethod"))),
    cancel: () => Effect.sync(() => onePasswordStatus(service.cancel())),
    disconnect: () =>
      service.disconnect().pipe(
        Effect.map(onePasswordStatus),
        Effect.mapError((error) => new PasswordManagerError({ cause: error.cause })),
      ),
    onChanged: (listener) => service.onChanged((status) => listener(onePasswordStatus(status))),
  };
}
