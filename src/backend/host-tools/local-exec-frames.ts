import { type DynamicRecord, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import type { HostToolRequest, ListedMachine } from "./host-tool-types";

export const LOCAL_EXEC_REQUESTS_PATH = "/local-exec/requests";
export const LOCAL_EXEC_RESPONSES_PATH = "/local-exec/responses";
export const DEFAULT_COMPUTER_ID = "this-computer";

export interface GatewayHeaderSession {
  readonly token: string;
  readonly headers: Readonly<Record<string, string>>;
}

export function localExecHeaders(session: GatewayHeaderSession): Record<string, string> {
  const headers: Record<string, string> = { ...session.headers };
  headers.authorization = `Bearer ${session.token}`;
  return headers;
}

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

export type LocalExecRequestFrame =
  | { readonly kind: "welcome"; readonly providerId: string }
  | { readonly kind: "retire-approval"; readonly approvalId: string }
  | {
      readonly kind: "exec";
      readonly requestId: string;
      readonly approvalId?: string;
      readonly machineId?: string;
      readonly serverMessage: Json;
    }
  | { readonly kind: "upload"; readonly requestId: string; readonly path: string; readonly bytesBase64: string }
  | { readonly kind: "download"; readonly requestId: string; readonly path: string }
  | { readonly kind: "device"; readonly requestId: string; readonly request: Json }
  | { readonly kind: "cancel"; readonly requestId: string };

export type LocalExecResponseFrame =
  | {
      readonly kind: "hello";
      readonly localRoot: string;
      readonly terminalsFolder: string;
      readonly computerId: string;
      readonly label: string;
    }
  | { readonly kind: "ping" }
  | { readonly kind: "client" | "control"; readonly requestId: string; readonly message: Json }
  | { readonly kind: "file"; readonly requestId: string }
  | { readonly kind: "file-error"; readonly requestId: string; readonly error: string };

export function toJson(value: unknown): Json {
  if (value === null || isString(value) || isBoolean(value) || isNumber(value)) return value;
  if (Array.isArray(value)) return value.map((entry) => toJson(entry));
  if (!isDynamicRecord(value)) return null;
  const record: { [key: string]: Json } = {};
  for (const [key, entry] of Object.entries(value)) record[key] = toJson(entry);
  return record;
}

function isBoolean(value: unknown): value is boolean {
  return value === true || value === false;
}

export function decodeRequestFrame(value: unknown): LocalExecRequestFrame | null {
  if (!isDynamicRecord(value) || !isString(value.kind)) return null;
  if (value.kind === "welcome" && isString(value.providerId)) return { kind: "welcome", providerId: value.providerId };
  if (value.kind === "retire-approval" && isString(value.approvalId)) {
    return { kind: "retire-approval", approvalId: value.approvalId };
  }
  if (value.kind === "cancel" && isString(value.requestId)) return { kind: "cancel", requestId: value.requestId };
  if (!isString(value.requestId)) return null;
  if (value.kind === "exec") {
    const serverMessage = toJson(value.serverMessage ?? null);
    const machineId = isString(value.machineId) ? value.machineId : undefined;
    return {
      kind: "exec",
      requestId: value.requestId,
      serverMessage,
      ...(isString(value.approvalId) ? { approvalId: value.approvalId } : {}),
      ...(machineId === undefined ? {} : { machineId }),
    };
  }
  if (value.kind === "upload" && isString(value.path) && isString(value.bytesBase64)) {
    return { kind: "upload", requestId: value.requestId, path: value.path, bytesBase64: value.bytesBase64 };
  }
  if (value.kind === "download" && isString(value.path)) {
    return { kind: "download", requestId: value.requestId, path: value.path };
  }
  if (value.kind === "device")
    return { kind: "device", requestId: value.requestId, request: toJson(value.request ?? null) };
  return null;
}

export function responsePostBody(
  providerId: string | undefined,
  frames: readonly LocalExecResponseFrame[],
  batchId?: string,
): { providerId?: string; batchId?: string; frames: readonly LocalExecResponseFrame[] } {
  return {
    ...(providerId === undefined ? {} : { providerId }),
    ...(batchId === undefined ? {} : { batchId }),
    frames,
  };
}

const SHELL_CASES = new Set([
  "shellArgs",
  "shellStreamArgs",
  "backgroundShellSpawnArgs",
  "piBashArgs",
  "miniSweAgentBashArgs",
  "shell_args",
  "shell_stream_args",
  "background_shell_spawn_args",
  "pi_bash_args",
  "mini_swe_agent_bash_args",
]);

function stringField(record: DynamicRecord, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (isString(value)) return value;
  }
  return undefined;
}

function screenshotOnly(value: DynamicRecord): boolean {
  const actions = value.actions;
  if (!Array.isArray(actions) || actions.length === 0) return false;
  return actions.every((entry) => {
    if (!isDynamicRecord(entry)) return false;
    const nested = entry.action;
    const action = isDynamicRecord(nested) ? nested : entry;
    return action.case === "screenshot" || action.screenshot != null;
  });
}

function requestBase(requestId: string, machineId: string | undefined): HostToolRequest {
  return {
    id: requestId,
    action: "shell",
    agentId: "",
    threadId: "",
    turnId: "",
    ...(machineId === undefined ? {} : { machineId }),
  };
}

function shellRequest(base: HostToolRequest, value: DynamicRecord): HostToolRequest | null {
  const command = stringField(value, "command");
  if (command === undefined) return null;
  const workingDirectory = stringField(value, "workingDirectory", "working_directory");
  return {
    ...base,
    action: "shell",
    command,
    ...(value.isBackground === true || value.is_background === true ? { isBackground: true } : {}),
    ...(workingDirectory === undefined ? {} : { workingDirectory }),
  };
}

export function hostRequestFromExec(
  requestId: string,
  serverMessage: unknown,
  machineId?: string,
): HostToolRequest | null {
  const root = isDynamicRecord(serverMessage) ? serverMessage : {};
  const nested = root.message;
  const message = isDynamicRecord(nested) ? nested : root;
  const name = isString(message.case) ? message.case : undefined;
  const rawValue = message.value;
  const value = isDynamicRecord(rawValue) ? rawValue : message;
  const base = requestBase(requestId, machineId);
  if (name !== undefined && SHELL_CASES.has(name)) return shellRequest(base, value);
  if (name === "writeArgs" || name === "write_args") {
    const filePath = stringField(value, "path");
    if (filePath === undefined) return null;
    return {
      ...base,
      action: "write-file",
      path: filePath,
      fileText: stringField(value, "fileText", "file_text") ?? "",
    };
  }
  if (name === "readArgs" || name === "redactedReadArgs" || name === "read_args" || name === "redacted_read_args") {
    const filePath = stringField(value, "path");
    if (filePath === undefined) return null;
    return { ...base, action: "read-file", path: filePath };
  }
  if (name === "lsArgs" || name === "ls_args") {
    const filePath = stringField(value, "path");
    if (filePath === undefined) return null;
    return { ...base, action: "list-directory", path: filePath };
  }
  if (name === "writeShellStdinArgs" || name === "write_shell_stdin_args") {
    return {
      ...base,
      action: "send-input",
      chars: stringField(value, "chars") ?? "",
      ...(isNumber(value.shellId) ? { shellId: value.shellId } : {}),
    };
  }
  if ((name === "computerUseArgs" || name === "computer_use_args") && screenshotOnly(value)) {
    return { ...base, action: "screenshot" };
  }
  if (name === "mcpArgs" || name === "mcp_args") return mcpRequest(base, value);
  return null;
}

function mcpRequest(base: HostToolRequest, value: DynamicRecord): HostToolRequest {
  const serverIdentifier = stringField(value, "serverIdentifier", "server_identifier");
  const providerIdentifier = stringField(value, "providerIdentifier", "provider_identifier");
  const args = value.args;
  return {
    ...base,
    action: "mcp",
    ...(serverIdentifier === undefined ? {} : { serverIdentifier }),
    ...(providerIdentifier === undefined ? {} : { providerIdentifier }),
    toolName: stringField(value, "toolName", "tool_name") ?? stringField(value, "name") ?? "",
    ...(isDynamicRecord(args) ? { arguments: args } : {}),
  };
}

export function decodeListedMachines(body: unknown): ListedMachine[] {
  const rows = Array.isArray(body) ? body : isDynamicRecord(body) && Array.isArray(body.machines) ? body.machines : [];
  const machines: ListedMachine[] = [];
  for (const row of rows) {
    if (!isDynamicRecord(row)) continue;
    const id = stringField(row, "id", "machineId");
    if (id === undefined || id.length === 0) continue;
    machines.push({
      id,
      label: stringField(row, "label") ?? "",
      connected: row.connected === true,
    });
  }
  return machines;
}

export function selectMachine(
  machines: readonly ListedMachine[],
  machineId: string | undefined,
): { ok: true; machine: ListedMachine } | { ok: false; code: "unavailable" } {
  const connected = machines.filter((machine) => machine.connected);
  if (machineId !== undefined) {
    const found = connected.find((machine) => machine.id === machineId);
    return found === undefined ? { ok: false, code: "unavailable" } : { ok: true, machine: found };
  }
  const only = connected.length === 1 ? connected[0] : undefined;
  if (only !== undefined) return { ok: true, machine: only };
  return { ok: false, code: "unavailable" };
}

export function shellResultMessage(
  command: string,
  workingDirectory: string,
  exitCode: number,
  stdout: string,
  stderr: string,
): Json {
  return {
    shellResult: {
      success: { command, workingDirectory, exitCode, signal: "", stdout, stderr, executionTime: 0 },
    },
  };
}

export function readResultMessage(filePath: string, content: string): Json {
  return {
    readResult: {
      success: { path: filePath, content, totalLines: content.split("\n").length, truncated: false },
    },
  };
}

export function refusedControlMessage(requestId: string, error: string): LocalExecResponseFrame {
  return { kind: "control", requestId, message: { throw: { error } } };
}
