import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isFiniteNumber, isIdentifier } from "./ipc-bounded-values";
import { type EventRoutine, isEventRoutineTrigger } from "./ipc-events";
import { isRoutineRun, ROUTINE_MISSED_POLICIES, type RoutineRun } from "./ipc-routines";
import { isBoolean, isDynamicRecord, isOneOf, isString } from "./runtime-values";

export const ROUTINE_FLOW_STEP_STATUSES = ["running", "succeeded", "failed", "skipped", "cancelled"] as const;
export type RoutineFlowStepStatus = (typeof ROUTINE_FLOW_STEP_STATUSES)[number];

export interface RoutineFlowLink {
  id: string;
  routineId: string;
  fromAgentId: string;
  toAgentId: string;
  instruction: string;
  createdAt: string;
}

export interface RoutineFlowStep {
  id: string;
  runId: string;
  agentId: string;
  deliveryId: string | null;
  input: string;
  output: string | null;
  status: RoutineFlowStepStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoutineFlowPosition {
  nodeKey: string;
  x: number;
  y: number;
}

export type RoutineFlowRoutineInfo = Omit<EventRoutine, "owner"> & { agentId: string };

export interface RoutineFlowRoutine {
  routine: RoutineFlowRoutineInfo;
  recentRuns: RoutineRun[];
  upcomingRuns: string[];
  steps: RoutineFlowStep[];
}

export interface RoutineFlowCanvas {
  agentId: string;
  routines: RoutineFlowRoutine[];
  links: RoutineFlowLink[];
  positions: RoutineFlowPosition[];
  placedAgentIds: string[];
}

export interface SaveRoutineFlowPositionInput {
  agentId: string;
  nodeKey: string;
  x: number;
  y: number;
}

export interface RemoveRoutineFlowPositionInput {
  agentId: string;
  nodeKey: string;
}

export interface ConnectRoutineFlowInput {
  routineId: string;
  fromAgentId: string;
  toAgentId: string;
  instruction?: string;
}

export interface DisconnectRoutineFlowInput {
  linkId: string;
}

export interface UpdateRoutineFlowLinkInput {
  linkId: string;
  instruction: string;
}

export interface StopRoutineFlowRunInput {
  routineId: string;
  runId: string;
}

export const ROUTINE_FLOW_MAX_COORDINATE = 1_000_000;

export function routineFlowAgentKey(agentId: string): string {
  return `agent:${agentId}`;
}

export function routineFlowRoutineKey(routineId: string): string {
  return `routine:${routineId}`;
}

export function isRoutineFlowNodeKey(value: unknown): value is string {
  if (!isString(value)) return false;
  const [kind, id, ...rest] = value.split(":");
  return rest.length === 0 && (kind === "agent" || kind === "routine") && isIdentifier(id);
}

function isCoordinate(value: unknown): value is number {
  return isFiniteNumber(value) && Math.abs(value) <= ROUTINE_FLOW_MAX_COORDINATE;
}

export function isRoutineFlowLink(value: unknown): value is RoutineFlowLink {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isIdentifier(value.routineId) &&
    isIdentifier(value.fromAgentId) &&
    isIdentifier(value.toAgentId) &&
    isBoundedString(value.instruction, INPUT_LIMITS.routineInstruction) &&
    isString(value.createdAt)
  );
}

export function isRoutineFlowStep(value: unknown): value is RoutineFlowStep {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isIdentifier(value.runId) &&
    isIdentifier(value.agentId) &&
    (value.deliveryId === null || isIdentifier(value.deliveryId)) &&
    isString(value.input) &&
    (value.output === null || isString(value.output)) &&
    isOneOf(ROUTINE_FLOW_STEP_STATUSES, value.status) &&
    (value.error === null || isString(value.error)) &&
    isString(value.createdAt) &&
    isString(value.updatedAt)
  );
}

function isRoutineFlowPosition(value: unknown): value is RoutineFlowPosition {
  return (
    isDynamicRecord(value) && isRoutineFlowNodeKey(value.nodeKey) && isCoordinate(value.x) && isCoordinate(value.y)
  );
}

function isRoutineFlowRoutineInfo(value: unknown): value is RoutineFlowRoutineInfo {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isIdentifier(value.agentId) &&
    isString(value.name) &&
    isString(value.instruction) &&
    isBoolean(value.active) &&
    isString(value.timezone) &&
    isEventRoutineTrigger(value.trigger) &&
    (value.limitPolicy === undefined || value.limitPolicy === "wait" || value.limitPolicy === "skip") &&
    (value.missedPolicy === undefined || isOneOf(ROUTINE_MISSED_POLICIES, value.missedPolicy)) &&
    isString(value.createdAt) &&
    isString(value.updatedAt)
  );
}

function isRoutineFlowRoutine(value: unknown): value is RoutineFlowRoutine {
  return (
    isDynamicRecord(value) &&
    isRoutineFlowRoutineInfo(value.routine) &&
    Array.isArray(value.recentRuns) &&
    value.recentRuns.every(isRoutineRun) &&
    Array.isArray(value.upcomingRuns) &&
    value.upcomingRuns.every(isString) &&
    Array.isArray(value.steps) &&
    value.steps.every(isRoutineFlowStep)
  );
}

export function isRoutineFlowCanvas(value: unknown): value is RoutineFlowCanvas {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.agentId) &&
    Array.isArray(value.routines) &&
    value.routines.every(isRoutineFlowRoutine) &&
    Array.isArray(value.links) &&
    value.links.every(isRoutineFlowLink) &&
    Array.isArray(value.positions) &&
    value.positions.every(isRoutineFlowPosition) &&
    Array.isArray(value.placedAgentIds) &&
    value.placedAgentIds.every(isIdentifier)
  );
}

export function isSaveRoutineFlowPositionInput(value: unknown): value is SaveRoutineFlowPositionInput {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.agentId) &&
    isRoutineFlowNodeKey(value.nodeKey) &&
    isCoordinate(value.x) &&
    isCoordinate(value.y)
  );
}

export function isRemoveRoutineFlowPositionInput(value: unknown): value is RemoveRoutineFlowPositionInput {
  return isDynamicRecord(value) && isIdentifier(value.agentId) && isRoutineFlowNodeKey(value.nodeKey);
}

export function isConnectRoutineFlowInput(value: unknown): value is ConnectRoutineFlowInput {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.routineId) &&
    isIdentifier(value.fromAgentId) &&
    isIdentifier(value.toAgentId) &&
    (value.instruction === undefined || isBoundedString(value.instruction, INPUT_LIMITS.routineInstruction))
  );
}

export function isDisconnectRoutineFlowInput(value: unknown): value is DisconnectRoutineFlowInput {
  return isDynamicRecord(value) && isIdentifier(value.linkId);
}

export function isStopRoutineFlowRunInput(value: unknown): value is StopRoutineFlowRunInput {
  return isDynamicRecord(value) && isIdentifier(value.routineId) && isIdentifier(value.runId);
}

export function isUpdateRoutineFlowLinkInput(value: unknown): value is UpdateRoutineFlowLinkInput {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.linkId) &&
    isBoundedString(value.instruction, INPUT_LIMITS.routineInstruction)
  );
}
