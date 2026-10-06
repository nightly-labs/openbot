// The routines that a restart when idle held must not be lost in the restart: the next start would
// skip them as missed. Main writes the hold window just before it restarts or quits, and reads it
// once at the next start. The writes are synchronous because the process quits right after them.

import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { isMissingFileError } from "../backend/file-errors";
import type { RoutineHoldWindow } from "../backend/routine-store";

export const ROUTINE_HOLD_FILE = "routine-hold.json";

export function writeRoutineHold(path: string, window: RoutineHoldWindow): void {
  writeFileSync(
    path,
    JSON.stringify({ version: 1, since: window.since.toISOString(), until: window.until.toISOString() }),
  );
}

export function clearRoutineHold(path: string): void {
  rmSync(path, { force: true });
}

/** Reads the window and removes the file, so a later start does not run the same routines again. */
export function takeRoutineHold(path: string, log: (message: string) => void): RoutineHoldWindow | undefined {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (!isMissingFileError(error)) log(`The routine hold could not be read: ${String(error)}`);
    return undefined;
  }
  try {
    clearRoutineHold(path);
  } catch (error) {
    log(`The routine hold could not be removed: ${String(error)}`);
  }
  try {
    const parsed = JSON.parse(text);
    if (!isDynamicRecord(parsed) || parsed.version !== 1 || !isString(parsed.since) || !isString(parsed.until)) {
      return undefined;
    }
    const since = new Date(parsed.since);
    const until = new Date(parsed.until);
    return Number.isNaN(since.getTime()) || Number.isNaN(until.getTime()) ? undefined : { since, until };
  } catch {
    return undefined;
  }
}
