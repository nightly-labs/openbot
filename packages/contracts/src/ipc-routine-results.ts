import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { MESSAGING_LIMITS, MESSAGING_PLATFORMS, type MessagingPlatform } from "./ipc-messaging";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

export const ROUTINE_RESULT_DELIVERY_STATUSES = ["pending", "sending", "sent", "failed", "uncertain"] as const;
export type RoutineResultDeliveryStatus = (typeof ROUTINE_RESULT_DELIVERY_STATUSES)[number];

export const ROUTINE_RESULT_DELIVERY_REASONS = [
  "expired",
  "connection-gone",
  "refused",
  "send-failed",
  "restart",
  "stopped",
] as const;
export type RoutineResultDeliveryReason = (typeof ROUTINE_RESULT_DELIVERY_REASONS)[number];

export interface RoutineResultDestination {
  connectionId: string;
  platform: MessagingPlatform;
  connectionName: string;
  placeId: string;
  placeName: string;
}

export interface RoutineResultPlace {
  id: string;
  name: string;
}

export interface RoutineResultConnectionOption {
  connectionId: string;
  platform: MessagingPlatform;
  connectionName: string;
  places: RoutineResultPlace[];
  placesFailed: boolean;
}

export interface RoutineResultDelivery {
  runId: string;
  status: RoutineResultDeliveryStatus;
  reason: RoutineResultDeliveryReason | null;
  attempts: number;
  destination: RoutineResultDestination;
  updatedAt: string;
  sentAt: string | null;
}

export interface RoutineResultRoutineInput {
  agentId: string;
  routineId: string;
}

export interface SetRoutineResultDestinationInput {
  agentId: string;
  routineId: string;
  destination: { connectionId: string; placeId: string; placeName: string } | null;
}

export interface ResendRoutineResultInput {
  agentId: string;
  runId: string;
}

function isPlaceName(value: unknown): value is string {
  return isBoundedString(value, MESSAGING_LIMITS.name);
}

export function isRoutineResultDestination(value: unknown): value is RoutineResultDestination {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.connectionId) &&
    isOneOf(MESSAGING_PLATFORMS, value.platform) &&
    isPlaceName(value.connectionName) &&
    isIdentifier(value.placeId) &&
    isPlaceName(value.placeName)
  );
}

export function isNullableRoutineResultDestination(value: unknown): value is RoutineResultDestination | null {
  return value === null || isRoutineResultDestination(value);
}

function isRoutineResultPlace(value: unknown): value is RoutineResultPlace {
  return isDynamicRecord(value) && isIdentifier(value.id) && isPlaceName(value.name);
}

function isRoutineResultConnectionOption(value: unknown): value is RoutineResultConnectionOption {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.connectionId) &&
    isOneOf(MESSAGING_PLATFORMS, value.platform) &&
    isPlaceName(value.connectionName) &&
    Array.isArray(value.places) &&
    value.places.every(isRoutineResultPlace) &&
    isBoolean(value.placesFailed)
  );
}

export function isRoutineResultConnectionOptions(value: unknown): value is RoutineResultConnectionOption[] {
  return Array.isArray(value) && value.every(isRoutineResultConnectionOption);
}

function isRoutineResultDelivery(value: unknown): value is RoutineResultDelivery {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.runId) &&
    isOneOf(ROUTINE_RESULT_DELIVERY_STATUSES, value.status) &&
    (value.reason === null || isOneOf(ROUTINE_RESULT_DELIVERY_REASONS, value.reason)) &&
    isNumber(value.attempts) &&
    isRoutineResultDestination(value.destination) &&
    isString(value.updatedAt) &&
    (value.sentAt === null || isString(value.sentAt))
  );
}

export function isRoutineResultDeliveries(value: unknown): value is RoutineResultDelivery[] {
  return Array.isArray(value) && value.every(isRoutineResultDelivery);
}

export function isRoutineResultRoutineInput(value: unknown): value is RoutineResultRoutineInput {
  return isDynamicRecord(value) && isIdentifier(value.agentId) && isIdentifier(value.routineId);
}

export function isSetRoutineResultDestinationInput(value: unknown): value is SetRoutineResultDestinationInput {
  if (!isDynamicRecord(value) || !isIdentifier(value.agentId) || !isIdentifier(value.routineId)) return false;
  const destination = value.destination;
  return (
    destination === null ||
    (isDynamicRecord(destination) &&
      isIdentifier(destination.connectionId) &&
      isIdentifier(destination.placeId) &&
      isPlaceName(destination.placeName))
  );
}

export function isResendRoutineResultInput(value: unknown): value is ResendRoutineResultInput {
  return isDynamicRecord(value) && isIdentifier(value.agentId) && isIdentifier(value.runId);
}

export function decodeRoutineResultConnectionOptions(value: unknown): RoutineResultConnectionOption[] {
  if (!isDynamicRecord(value) || !isRoutineResultConnectionOptions(value.connections))
    throw new Error("Invalid routine result connections.");
  return value.connections;
}

export function decodeRoutineResultDestinationAnswer(value: unknown): RoutineResultDestination | null {
  if (!isDynamicRecord(value) || !isNullableRoutineResultDestination(value.destination))
    throw new Error("Invalid routine result destination.");
  return value.destination;
}
