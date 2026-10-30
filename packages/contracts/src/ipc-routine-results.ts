import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { MESSAGING_LIMITS, MESSAGING_PLATFORMS, type MessagingPlatform } from "./ipc-messaging";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

/**
 * Routine results: the answer of an agent routine's run, sent on to a messaging place outside OpenBot.
 * Whether the answer reached the place is the delivery's status, not the run's: a run that succeeded
 * keeps that status when its delivery fails. Only this computer's host keeps a destination. An owner or
 * admin of a joined server reads the connections and sets a destination through `routine-results-v1`;
 * the deliveries never cross the Team API.
 */

/**
 * - `pending` waits to try again: the connection does not run now.
 * - `sending` is on its way.
 * - `sent` reached the place.
 * - `failed` did not reach the place, and nothing of it was posted.
 * - `uncertain` failed or stopped during the post: a part of a long answer can be in the place.
 */
export const ROUTINE_RESULT_DELIVERY_STATUSES = ["pending", "sending", "sent", "failed", "uncertain"] as const;
export type RoutineResultDeliveryStatus = (typeof ROUTINE_RESULT_DELIVERY_STATUSES)[number];

/**
 * - `expired`: the connection did not run for a day.
 * - `connection-gone`: the connection was removed or turned off.
 * - `refused`: the connection cannot post in that place.
 * - `send-failed`: the platform refused or did not answer the post.
 * - `restart`: OpenBot stopped during the post.
 * - `stopped`: the user stopped sending to a place before the answer went.
 */
export const ROUTINE_RESULT_DELIVERY_REASONS = [
  "expired",
  "connection-gone",
  "refused",
  "send-failed",
  "restart",
  "stopped",
] as const;
export type RoutineResultDeliveryReason = (typeof ROUTINE_RESULT_DELIVERY_REASONS)[number];

/** The place a routine sends its answers to, with the names the user picked it by. */
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

/** An enabled connection and the places it can post in. `placesFailed` is true when the platform did not answer. */
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

/** Null `destination` stops sending. The connection's name and platform come from the host. */
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

/** The `routine-results-v1` options answer. The route codec has already checked its fields. */
export function decodeRoutineResultConnectionOptions(value: unknown): RoutineResultConnectionOption[] {
  if (!isDynamicRecord(value) || !isRoutineResultConnectionOptions(value.connections))
    throw new Error("Invalid routine result connections.");
  return value.connections;
}

/** The `routine-results-v1` destination answer. */
export function decodeRoutineResultDestinationAnswer(value: unknown): RoutineResultDestination | null {
  if (!isDynamicRecord(value) || !isNullableRoutineResultDestination(value.destination))
    throw new Error("Invalid routine result destination.");
  return value.destination;
}
