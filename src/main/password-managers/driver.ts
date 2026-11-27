import type { PasswordManagerConnectMethod, PasswordManagerId, PasswordManagerStatus } from "@openbot/contracts/ipc";
import { type Effect, Schema } from "effect";
import type { PasswordVault } from "../../backend/password-vault";

export class PasswordManagerError extends Schema.TaggedError<PasswordManagerError>()("PasswordManagerError", {
  cause: Schema.Defect(),
}) {}

export interface PasswordManagerDriver {
  readonly id: PasswordManagerId;
  readonly prefix: string;
  readonly brand: string;
  readonly signInHosts: readonly string[];
  readonly vault: PasswordVault;
  status(): PasswordManagerStatus;
  connect(method: PasswordManagerConnectMethod): Effect.Effect<PasswordManagerStatus, PasswordManagerError>;
  cancel(): Effect.Effect<PasswordManagerStatus, PasswordManagerError>;
  disconnect(): Effect.Effect<PasswordManagerStatus, PasswordManagerError>;
  onChanged(listener: (status: PasswordManagerStatus) => void): () => void;
  load?(): Effect.Effect<void>;
  dispose?(): Effect.Effect<void>;
}

export function passwordManagerFailure(message: string): PasswordManagerError {
  return new PasswordManagerError({ cause: new Error(message) });
}
