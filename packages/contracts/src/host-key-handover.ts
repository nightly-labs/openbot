// A host key handover: the host's previous Ed25519 key and its new key both sign one statement,
// so a client that trusts the previous key can trust the new key without a new pairing.
//
// The host signs (`src/main/team-store.ts`), the account service checks and stores the chain
// (`apps/auth-api`), and every client follows it from the key it already trusts
// (`packages/team-client/src/host-key-handover.ts`). The account service only relays the chain: it
// has no key that can sign a step, so it cannot hand a host to a key of its own.
//
// Guards rather than a schema library, like the rest of this package (see `remote-control-plane.ts`).

import { decodeRecord } from "./ipc-decoding";
import { isNumber, isString } from "./runtime-values";

export interface HostKeyHandover {
  hostId: string;
  /** Epoch milliseconds. */
  issuedAt: number;
  /** SPKI PEM of the key that the host used before this step. */
  previousPublicKey: string;
  /** SPKI PEM of the key that the host uses after this step. */
  publicKey: string;
  /** Base64url Ed25519 signature of `hostKeyHandoverStatement` by the previous key. */
  previousSignature: string;
  /** Base64url Ed25519 signature of `hostKeyHandoverStatement` by the new key. */
  signature: string;
}

/** The account service sends at most this many of the latest steps. A client further behind pairs again. */
export const HOST_KEY_HANDOVER_LIMIT = 32;

const MAX_PUBLIC_KEY_LENGTH = 512;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/u;

/** The exact text that both keys sign. */
export function hostKeyHandoverStatement(
  handover: Pick<HostKeyHandover, "hostId" | "issuedAt" | "previousPublicKey" | "publicKey">,
): string {
  return JSON.stringify([
    "openbot-host-key-handover-v1",
    handover.hostId,
    handover.issuedAt,
    handover.previousPublicKey,
    handover.publicKey,
  ]);
}

export function decodeHostKeyHandover(value: unknown): HostKeyHandover {
  const record = decodeRecord(value, "host key handover");
  return {
    hostId: text(record.hostId, "hostId", 128),
    issuedAt: timestamp(record.issuedAt),
    previousPublicKey: text(record.previousPublicKey, "previousPublicKey", MAX_PUBLIC_KEY_LENGTH),
    publicKey: text(record.publicKey, "publicKey", MAX_PUBLIC_KEY_LENGTH),
    previousSignature: signature(record.previousSignature, "previousSignature"),
    signature: signature(record.signature, "signature"),
  };
}

/**
 * The optional `keyHandovers` field of a host record. An account service from before handovers sends
 * none, and a malformed list is dropped: the client then treats a changed key as it did before.
 */
export function optionalHostKeyHandovers(value: unknown): HostKeyHandover[] {
  if (!Array.isArray(value) || value.length > HOST_KEY_HANDOVER_LIMIT) return [];
  try {
    return value.map(decodeHostKeyHandover);
  } catch {
    return [];
  }
}

function text(value: unknown, field: string, maximum: number): string {
  if (!isString(value) || !value || value.length > maximum) throw new Error(`Invalid host key handover ${field}.`);
  return value;
}

function signature(value: unknown, field: string): string {
  if (!isString(value) || !SIGNATURE_PATTERN.test(value)) throw new Error(`Invalid host key handover ${field}.`);
  return value;
}

function timestamp(value: unknown): number {
  if (!isNumber(value) || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid host key handover issuedAt.");
  return value;
}
