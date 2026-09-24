// What main answers for Computer Use: its state, its permissions, and where to draw the highlight.
//
// Each decoder checks every field the contract type requires and keeps each optional field it
// carries, so a value the renderer reads always has the shape its type says.

import {
  COMPUTER_USE_STATUSES,
  type ComputerUseCoveredArea,
  type ComputerUseCursorPoint,
  type ComputerUseHighlightPlacement,
  type ComputerUsePermission,
  type ComputerUsePermissionApp,
  type ComputerUseState,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";

export function decodeComputerUseState(value: unknown): ComputerUseState {
  if (
    !isDynamicRecord(value) ||
    !isOneOf(COMPUTER_USE_STATUSES, value.status) ||
    !Array.isArray(value.permissions) ||
    (value.message !== null && !isString(value.message))
  ) {
    throw new Error("Invalid Computer Use state.");
  }
  return {
    status: value.status,
    permissions: value.permissions.map(decodeComputerUsePermission),
    message: value.message,
  };
}

function decodeComputerUseCursorPoint(value: unknown): ComputerUseCursorPoint | null {
  if (value === null || value === undefined) return null;
  if (!isDynamicRecord(value) || typeof value.x !== "number" || typeof value.y !== "number") {
    throw new Error("Invalid Computer Use highlight placement.");
  }
  return { x: value.x, y: value.y };
}

export function decodeComputerUseHighlightPlacement(value: unknown): ComputerUseHighlightPlacement {
  if (
    !isDynamicRecord(value) ||
    typeof value.x !== "number" ||
    typeof value.y !== "number" ||
    typeof value.width !== "number" ||
    typeof value.height !== "number" ||
    typeof value.cornerRadius !== "number" ||
    typeof value.windowTitle !== "string" ||
    !Array.isArray(value.covered)
  ) {
    throw new Error("Invalid Computer Use highlight placement.");
  }
  return {
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
    cornerRadius: value.cornerRadius,
    windowTitle: value.windowTitle,
    cursor: decodeComputerUseCursorPoint(value.cursor),
    covered: value.covered.map(decodeComputerUseCoveredArea),
  };
}

function decodeComputerUseCoveredArea(value: unknown): ComputerUseCoveredArea {
  if (
    !isDynamicRecord(value) ||
    typeof value.x !== "number" ||
    typeof value.y !== "number" ||
    typeof value.width !== "number" ||
    typeof value.height !== "number"
  ) {
    throw new Error("Invalid Computer Use highlight placement.");
  }
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

export function decodeComputerUsePermissionApp(value: unknown): ComputerUsePermissionApp | null {
  if (value === null) return null;
  if (
    !isDynamicRecord(value) ||
    !isString(value.name) ||
    (value.iconDataUrl !== null && !isString(value.iconDataUrl))
  ) {
    throw new Error("Invalid Computer Use application.");
  }
  return { name: value.name, iconDataUrl: value.iconDataUrl };
}

function decodeComputerUsePermission(value: unknown): ComputerUsePermission {
  if (
    !isDynamicRecord(value) ||
    !isOneOf(["screen-recording", "accessibility"] as const, value.id) ||
    typeof value.granted !== "boolean"
  ) {
    throw new Error("Invalid Computer Use permission.");
  }
  return { id: value.id, granted: value.granted };
}
