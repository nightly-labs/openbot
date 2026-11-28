import { decodeRecord } from "./ipc-decoding";
import { isDynamicRecord, isNumber, isString } from "./runtime-values";

export interface OwnerTransfer {
  transferId: string;
  hostId: string;
  hostName: string;
  fromEmail: string;
  fromName: string | null;
  toEmail: string;
  createdAt: number;
  expiresAt: number;
}

export interface AcceptedOwnerTransfer {
  hostId: string;
  hostName: string;
}

export function decodeOwnerTransfer(value: unknown): OwnerTransfer {
  const record = decodeRecord(value, "ownership transfer");
  if (record.fromName !== null && !isString(record.fromName)) throw new Error("Invalid ownership transfer.");
  return {
    transferId: text(record.transferId),
    hostId: text(record.hostId),
    hostName: text(record.hostName),
    fromEmail: text(record.fromEmail),
    fromName: record.fromName,
    toEmail: text(record.toEmail),
    createdAt: time(record.createdAt),
    expiresAt: time(record.expiresAt),
  };
}

export function decodePendingOwnerTransfer(value: unknown): OwnerTransfer | null {
  const record = decodeRecord(value, "pending ownership transfer");
  return record.transfer === null ? null : decodeOwnerTransfer(record.transfer);
}

export function decodeIncomingOwnerTransfers(value: unknown): OwnerTransfer[] {
  const record = decodeRecord(value, "ownership transfers");
  if (!Array.isArray(record.transfers)) throw new Error("Invalid ownership transfers.");
  return record.transfers.map(decodeOwnerTransfer);
}

export function decodeListedOwnerTransfers(value: unknown): OwnerTransfer[] | null {
  if (!isDynamicRecord(value) || !Array.isArray(value.pendingIncomingTransfers)) return null;
  const listed = value.pendingIncomingTransfers;
  try {
    return listed.map(decodeOwnerTransfer);
  } catch {
    return null;
  }
}

export function decodeAcceptedOwnerTransfer(value: unknown): AcceptedOwnerTransfer {
  const record = decodeRecord(value, "accepted ownership transfer");
  return { hostId: text(record.hostId), hostName: text(record.hostName) };
}

function text(value: unknown): string {
  if (!isString(value) || !value) throw new Error("Invalid ownership transfer.");
  return value;
}

function time(value: unknown): number {
  if (!isNumber(value) || !Number.isFinite(value)) throw new Error("Invalid ownership transfer.");
  return value;
}
