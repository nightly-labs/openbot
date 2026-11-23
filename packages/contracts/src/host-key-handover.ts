import { decodeRecord } from "./ipc-decoding";
import { isNumber, isString } from "./runtime-values";

export interface HostKeyHandover {
  hostId: string;
  issuedAt: number;
  previousPublicKey: string;
  publicKey: string;
  previousSignature: string;
  signature: string;
}

export const HOST_KEY_HANDOVER_LIMIT = 32;

const MAX_PUBLIC_KEY_LENGTH = 512;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/u;

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
