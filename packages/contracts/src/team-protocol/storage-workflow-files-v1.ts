import { isDynamicRecord, isString } from "../runtime-values";
import { STORAGE_ROUTES } from "./storage-v1";
import type { TeamProtocolV2Json } from "./webrtc-framing";

export const STORAGE_WORKFLOW_FILES_CAPABILITY = "storage-workflow-files-v1";

const IDENTIFIER_LIMIT = 128;
const NAME_LIMIT = 255;

function invalid(): never {
  throw new Error("Invalid storage workflow file.");
}

function identifier(value: unknown): string {
  if (!isString(value) || value.length === 0 || value.length > IDENTIFIER_LIMIT) invalid();
  return value;
}

function name(value: unknown): string {
  if (!isString(value) || value.length > NAME_LIMIT) invalid();
  return value;
}

function folder(value: unknown): TeamProtocolV2Json {
  if (value === null) return null;
  if (!isDynamicRecord(value)) invalid();
  return { id: identifier(value.id), name: name(value.name) };
}

function workflow(value: unknown): TeamProtocolV2Json {
  if (!isDynamicRecord(value)) invalid();
  return { id: identifier(value.id), name: name(value.name), folder: folder(value.folder) };
}

export function withStorageWorkflowFiles(
  path: string,
  projected: TeamProtocolV2Json,
  source: unknown,
): TeamProtocolV2Json {
  if (new URL(path, "http://openbot.invalid").pathname !== STORAGE_ROUTES.usage) return projected;
  if (!isDynamicRecord(projected) || !isDynamicRecord(source)) return projected;
  const files = projected.files;
  const sourceFiles = source.files;
  if (!Array.isArray(files) || !Array.isArray(sourceFiles) || files.length !== sourceFiles.length) return projected;
  return {
    ...projected,
    files: files.map((file, index): TeamProtocolV2Json => {
      const sourceFile = sourceFiles[index];
      if (!isDynamicRecord(file) || !isDynamicRecord(sourceFile) || sourceFile.workflow === undefined) return file;
      if (sourceFile.id !== file.id) invalid();
      return { ...file, workflow: workflow(sourceFile.workflow) };
    }),
  };
}
