// The contract between the password-manager engine and one manager. A driver owns the connection of
// one manager: its sign-in, its stored access and its CLI. The engine owns the list, the checks that
// every manager shares, and the login routes of the browser. A new manager needs only a new driver.

import type { PasswordManagerConnectMethod, PasswordManagerId, PasswordManagerStatus } from "@openbot/contracts/ipc";
import { type Effect, Schema } from "effect";
import type { PasswordVault } from "../../backend/password-vault";

/** Keeps the original failure private. The cause is an `Error` whose message is catalog text. */
export class PasswordManagerError extends Schema.TaggedError<PasswordManagerError>()("PasswordManagerError", {
  cause: Schema.Defect(),
}) {}

export interface PasswordManagerDriver {
  readonly id: PasswordManagerId;
  /** The prefix of this manager's login ids in the browser's vault router. A released prefix never changes. */
  readonly prefix: string;
  /** The brand name, which agent text uses. */
  readonly brand: string;
  /**
   * The hosts of the pages that `signInUrl` can name. Main opens only an `https:` page on one of them.
   * Empty when the manager has no `browser` sign-in.
   */
  readonly signInHosts: readonly string[];
  /** The logins that the browser fills from this manager. */
  readonly vault: PasswordVault;
  /** The status now. `methods` names each method that `connect` takes, other than `extra-password`. */
  status(): PasswordManagerStatus;
  /** Starts or continues a connection, and answers the status at once. A long sign-in continues after the answer. */
  connect(method: PasswordManagerConnectMethod): Effect.Effect<PasswordManagerStatus, PasswordManagerError>;
  /** Stops a sign-in that runs. A connection that is done stays. */
  cancel(): Effect.Effect<PasswordManagerStatus, PasswordManagerError>;
  /** Stops access, and removes the stored access and the manager's data on this computer. */
  disconnect(): Effect.Effect<PasswordManagerStatus, PasswordManagerError>;
  onChanged(listener: (status: PasswordManagerStatus) => void): () => void;
  /** Reads the stored connection. A driver whose service loads on its own has none. */
  load?(): Effect.Effect<void>;
  /** Stops the sign-in and the child processes. The stored connection stays. */
  dispose?(): Effect.Effect<void>;
}

/** A failure whose message is catalog text. */
export function passwordManagerFailure(message: string): PasswordManagerError {
  return new PasswordManagerError({ cause: new Error(message) });
}
