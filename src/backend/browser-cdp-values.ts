import { type DynamicRecord, isBoolean, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";

const AUTOMATION_WORLD_NAME = "openbot-browser-automation";

export type CdpResult = DynamicRecord;

export type SendCommand = (method: string, params?: DynamicRecord, sessionId?: string) => Promise<CdpResult>;

export function assertBeforeDeadline(deadline: number | undefined): void {
  if (deadline !== undefined && Date.now() >= deadline) throw new Error("Browser wait condition timed out.");
}

export async function automationContextId(send: SendCommand, sessionId?: string): Promise<number> {
  const tree = await send("Page.getFrameTree", {}, sessionId);
  const frameId = frameTreeRootId(tree);
  if (!frameId) throw new Error("The browser automation world has no frame.");
  const world = await send(
    "Page.createIsolatedWorld",
    { frameId, worldName: AUTOMATION_WORLD_NAME, grantUniveralAccess: false },
    sessionId,
  );
  const contextId = numberValue(world.executionContextId);
  if (!contextId) throw new Error("The browser automation world is unavailable.");
  return contextId;
}

function frameTreeRootId(value: CdpResult): string {
  return stringValue(recordValue(recordValue(value.frameTree)?.frame)?.id);
}

export function frameIds(value: CdpResult): string[] {
  const ids: string[] = [];
  const pending = [recordValue(value.frameTree)];
  while (pending.length > 0) {
    const tree = pending.shift();
    if (!tree) continue;
    const id = stringValue(recordValue(tree.frame)?.id);
    if (id) ids.push(id);
    if (Array.isArray(tree.childFrames)) pending.push(...tree.childFrames.map(recordValue));
  }
  return ids;
}

export function exceptionDescription(value: CdpResult): string {
  return stringValue(recordValue(value.exception)?.description) || stringValue(value.text) || "Unknown page error";
}

export function textMatches(actual: string, expected: string, exact = false): boolean {
  const left = actual.trim().toLocaleLowerCase();
  const right = expected.trim().toLocaleLowerCase();
  return exact ? left === right : left.includes(right);
}

export function axValue(value: unknown): string {
  const record = recordValue(value);
  const raw = record?.value;
  return isString(raw) || isNumber(raw) || isBoolean(raw) ? String(raw) : "";
}

export function recordValue(value: unknown): CdpResult | undefined {
  return isRecord(value) ? value : undefined;
}

export function isRecord(value: unknown): value is CdpResult {
  return isDynamicRecord(value);
}

export function stringValue(value: unknown): string {
  return isString(value) ? value : "";
}

export function numberValue(value: unknown): number {
  return isFiniteNumber(value) ? value : 0;
}

export function isFiniteNumber(value: unknown): value is number {
  return isNumber(value) && Number.isFinite(value);
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
