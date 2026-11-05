// Bitwarden as a driver of the password-manager engine. The Bitwarden service keeps its own panel,
// IPC group, Team API routes, store and teardown; this adapter only shows its status in the shared
// form. It has no shared connect method: the Bitwarden panel connects it.

import type { BitwardenConnectorStatus, PasswordManagerStatus } from "@openbot/contracts/ipc";
import { disconnectedPasswordManager } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { PASSWORD_MANAGER_BRANDS } from "../../backend/password-vault";
import type { BitwardenConnectorService } from "../bitwarden-connector-service";
import { type PasswordManagerDriver, PasswordManagerError, passwordManagerFailure } from "./driver";

function bitwardenStatus(status: BitwardenConnectorStatus): PasswordManagerStatus {
  const base = disconnectedPasswordManager("bitwarden");
  if (status.connecting) return { ...base, state: "signing-in", step: "setup" };
  if (status.connected) return { ...base, state: "connected" };
  return status.error ? { ...base, state: "failed", error: status.error } : base;
}

export function bitwardenDriver(service: BitwardenConnectorService): PasswordManagerDriver {
  return {
    id: "bitwarden",
    prefix: "bitwarden:",
    brand: PASSWORD_MANAGER_BRANDS.bitwarden,
    signInHosts: [],
    vault: service,
    status: () => bitwardenStatus(service.status()),
    connect: () => Effect.fail(passwordManagerFailure(sourceText("error.connector.passwordManagerMethod"))),
    // A Bitwarden sign-in is short and has no cancel; the status shows when it ends.
    cancel: () => Effect.sync(() => bitwardenStatus(service.status())),
    disconnect: () =>
      service.disconnect().pipe(
        Effect.map(bitwardenStatus),
        Effect.mapError((error) => new PasswordManagerError({ cause: error.cause })),
      ),
    onChanged: (listener) => service.onChanged((status) => listener(bitwardenStatus(status))),
  };
}
