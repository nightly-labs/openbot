// What main answers when macOS was asked for Automation access to Apple apps.

import { MAC_AUTOMATION_STATUSES, MAC_AUTOMATION_TARGETS, type MacAutomationResult } from "@openbot/contracts/ipc";
import { isDynamicRecord, isOneOf } from "@openbot/contracts/runtime-values";

function decodeMacAutomationResult(value: unknown): MacAutomationResult {
  if (
    !isDynamicRecord(value) ||
    !isOneOf(MAC_AUTOMATION_TARGETS, value.target) ||
    !isOneOf(MAC_AUTOMATION_STATUSES, value.status)
  ) {
    throw new Error("Invalid Automation answer.");
  }
  return { target: value.target, status: value.status };
}

export function decodeMacAutomationResults(value: unknown): MacAutomationResult[] {
  if (!Array.isArray(value)) throw new Error("Invalid Automation answers.");
  return value.map(decodeMacAutomationResult);
}
