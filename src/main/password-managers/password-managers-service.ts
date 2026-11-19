import {
  isPasswordManagerId,
  type PasswordManagerConnectInput,
  type PasswordManagerConnectMethod,
  type PasswordManagerId,
  type PasswordManagerStatus,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { PASSWORD_MANAGER_BRANDS } from "../../backend/password-vault";
import type { PasswordVaultSource } from "../../backend/password-vault-router";
import { type PasswordManagerDriver, type PasswordManagerError, passwordManagerFailure } from "./driver";

export class PasswordManagersService {
  readonly #drivers: ReadonlyMap<PasswordManagerId, PasswordManagerDriver>;
  readonly #listeners = new Set<(status: PasswordManagerStatus) => void>();

  constructor(drivers: readonly PasswordManagerDriver[]) {
    this.#drivers = new Map(drivers.map((driver) => [driver.id, driver]));
    if (this.#drivers.size !== drivers.length) throw new Error("Two password manager drivers have the same id.");
    for (const driver of drivers) driver.onChanged((status) => this.#emit(status));
  }

  readonly load = Effect.fn("PasswordManagers.load")(function* (this: PasswordManagersService) {
    for (const driver of this.#drivers.values()) if (driver.load) yield* driver.load();
  }).bind(this);

  readonly dispose = Effect.fn("PasswordManagers.dispose")(function* (this: PasswordManagersService) {
    for (const driver of this.#drivers.values()) if (driver.dispose) yield* driver.dispose();
  }).bind(this);

  list(): PasswordManagerStatus[] {
    return [...this.#drivers.values()].map((driver) => driver.status());
  }

  onChanged(listener: (status: PasswordManagerStatus) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  refusal(manager: string, method?: PasswordManagerConnectMethod): string | null {
    const driver = isPasswordManagerId(manager) ? this.#drivers.get(manager) : undefined;
    if (!driver) return sourceText("error.connector.passwordManagerUnknown");
    if (!method) return null;
    const kind = method.kind === "extra-password" ? "browser" : method.kind;
    return driver.status().methods.includes(kind) ? null : sourceText("error.connector.passwordManagerMethod");
  }

  readonly connect = Effect.fn("PasswordManagers.connect")(function* (
    this: PasswordManagersService,
    input: PasswordManagerConnectInput,
  ): Effect.fn.Return<PasswordManagerStatus, PasswordManagerError> {
    const refused = this.refusal(input.manager, input.method);
    if (refused) return yield* passwordManagerFailure(refused);
    return yield* this.#driver(input.manager).connect(input.method);
  }).bind(this);

  readonly cancel = Effect.fn("PasswordManagers.cancel")(function* (
    this: PasswordManagersService,
    manager: PasswordManagerId,
  ): Effect.fn.Return<PasswordManagerStatus, PasswordManagerError> {
    const refused = this.refusal(manager);
    if (refused) return yield* passwordManagerFailure(refused);
    return yield* this.#driver(manager).cancel();
  }).bind(this);

  readonly disconnect = Effect.fn("PasswordManagers.disconnect")(function* (
    this: PasswordManagersService,
    manager: PasswordManagerId,
  ): Effect.fn.Return<PasswordManagerStatus, PasswordManagerError> {
    const refused = this.refusal(manager);
    if (refused) return yield* passwordManagerFailure(refused);
    return yield* this.#driver(manager).disconnect();
  }).bind(this);

  signInPage(manager: PasswordManagerId, status?: PasswordManagerStatus): string | null {
    const driver = this.#drivers.get(manager);
    if (!driver) return null;
    return allowedSignInPage((status ?? driver.status()).signInUrl, driver.signInHosts);
  }

  routes(): PasswordVaultSource[] {
    return [...this.#drivers.values()].map(({ id, prefix, vault }) => ({
      prefix,
      name: PASSWORD_MANAGER_BRANDS[id],
      vault,
    }));
  }

  #driver(manager: PasswordManagerId): PasswordManagerDriver {
    const driver = this.#drivers.get(manager);
    if (!driver) throw new Error(sourceText("error.connector.passwordManagerUnknown"));
    return driver;
  }

  #emit(status: PasswordManagerStatus): void {
    for (const listener of this.#listeners) listener(status);
  }
}

export function allowedSignInPage(url: string | null, hosts: readonly string[]): string | null {
  if (!url) return null;
  try {
    const page = new URL(url);
    if (page.protocol !== "https:" || page.username || page.password || page.port) return null;
    return hosts.includes(page.hostname) ? page.href : null;
  } catch {
    return null;
  }
}
