import { isDynamicRecord, isNumber, isString } from "../runtime-values";

export const WORKFLOW_PRESENCE_CAPABILITY = "workflow-presence-v1";

export const WORKFLOW_SPOT_CONTROL = "workflow-spot";
export const WORKFLOW_SPOT_EVENT = "workflow-spot-changed";

export const WORKFLOW_PRESENCE_LIMITS = {
  identifier: 128,
  coordinate: 10_000_000,
  sendIntervalMs: 50,
  keepAliveMs: 10_000,
  staleMs: 30_000,
} as const;

export type WorkflowSpotPoint = { x: number; y: number };

export type WorkflowSpot = { at: WorkflowSpotPoint | null; selected: string | null };

export type WorkflowSpotControl = {
  type: typeof WORKFLOW_SPOT_CONTROL;
  workflowId: string | null;
  at: WorkflowSpotPoint | null;
  selected: string | null;
};

export type WorkflowSpotInput = Omit<WorkflowSpotControl, "type">;

export type WorkflowSpotEvent = {
  type: typeof WORKFLOW_SPOT_EVENT;
  workflowId: string;
  memberId: string;
  spot: WorkflowSpot | null;
};

function isIdentifier(value: unknown): value is string {
  return isString(value) && value.length > 0 && value.length <= WORKFLOW_PRESENCE_LIMITS.identifier;
}

function isNullableIdentifier(value: unknown): value is string | null {
  return value === null || isIdentifier(value);
}

function isCoordinate(value: unknown): value is number {
  return isNumber(value) && Number.isFinite(value) && Math.abs(value) <= WORKFLOW_PRESENCE_LIMITS.coordinate;
}

function isPoint(value: unknown): value is WorkflowSpotPoint | null {
  return value === null || (isDynamicRecord(value) && isCoordinate(value.x) && isCoordinate(value.y));
}

function isSpot(value: unknown): value is WorkflowSpot | null {
  return value === null || (isDynamicRecord(value) && isPoint(value.at) && isNullableIdentifier(value.selected));
}

function point(value: WorkflowSpotPoint | null): WorkflowSpotPoint | null {
  return value && { x: value.x, y: value.y };
}

function invalid(): never {
  throw new Error("Invalid workflow presence payload.");
}

export function isWorkflowSpotEvent(value: unknown): value is WorkflowSpotEvent {
  return (
    isDynamicRecord(value) &&
    value.type === WORKFLOW_SPOT_EVENT &&
    isIdentifier(value.workflowId) &&
    isIdentifier(value.memberId) &&
    isSpot(value.spot)
  );
}

export function workflowSpotControl(value: unknown): WorkflowSpotControl | null {
  if (!isDynamicRecord(value) || value.type !== WORKFLOW_SPOT_CONTROL) return null;
  if (!isNullableIdentifier(value.workflowId) || !isPoint(value.at) || !isNullableIdentifier(value.selected))
    return invalid();
  const open = value.workflowId !== null;
  return {
    type: WORKFLOW_SPOT_CONTROL,
    workflowId: value.workflowId,
    at: open ? point(value.at) : null,
    selected: open ? value.selected : null,
  };
}

export function workflowSpotEvent(value: unknown): WorkflowSpotEvent | null {
  if (!isDynamicRecord(value) || value.type !== WORKFLOW_SPOT_EVENT) return null;
  if (!isWorkflowSpotEvent(value)) return invalid();
  return {
    type: WORKFLOW_SPOT_EVENT,
    workflowId: value.workflowId,
    memberId: value.memberId,
    spot: value.spot && { at: point(value.spot.at), selected: value.spot.selected },
  };
}

export function decodeWorkflowSpotInput(value: unknown): WorkflowSpotInput {
  if (!isDynamicRecord(value)) return invalid();
  const control = workflowSpotControl({ ...value, type: WORKFLOW_SPOT_CONTROL });
  if (!control) return invalid();
  return { workflowId: control.workflowId, at: control.at, selected: control.selected };
}
