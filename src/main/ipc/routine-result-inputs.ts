import {
  isResendRoutineResultInput,
  isRoutineResultRoutineInput,
  isSetRoutineResultDestinationInput,
  type ResendRoutineResultInput,
  type RoutineResultRoutineInput,
  type SetRoutineResultDestinationInput,
} from "@openbot/contracts/ipc";

export function parseRoutineResultRoutine(value: unknown): RoutineResultRoutineInput {
  if (!isRoutineResultRoutineInput(value)) throw new Error("Invalid routine result routine.");
  return { agentId: value.agentId, routineId: value.routineId };
}

export function parseSetRoutineResultDestination(value: unknown): SetRoutineResultDestinationInput {
  if (!isSetRoutineResultDestinationInput(value)) throw new Error("Invalid routine result destination.");
  const destination = value.destination;
  return {
    agentId: value.agentId,
    routineId: value.routineId,
    destination: destination
      ? { connectionId: destination.connectionId, placeId: destination.placeId, placeName: destination.placeName }
      : null,
  };
}

export function parseResendRoutineResult(value: unknown): ResendRoutineResultInput {
  if (!isResendRoutineResultInput(value)) throw new Error("Invalid routine result delivery.");
  return { agentId: value.agentId, runId: value.runId };
}
