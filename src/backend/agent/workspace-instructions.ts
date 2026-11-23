import { chmod, lstat, open, realpath } from "node:fs/promises";
import { join } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AGENT_INSTRUCTION_FILE_NAMES,
  AGENT_INSTRUCTIONS_READ_LIMIT,
  type AgentInstructionFileName,
  type AgentInstructionsFile,
} from "@openbot/contracts/ipc";
import { Effect, Option, Schema } from "effect";
import { writeFileAtomically } from "../atomic-json-file";
import { isMissingFileError } from "../file-errors";
import { isPathInside } from "../path-containment";

export class AgentInstructionsFileRefused extends Schema.TaggedError<AgentInstructionsFileRefused>()(
  "AgentInstructionsFileRefused",
  { reason: Schema.Literals(["too-large", "outside", "changed"]) },
) {}

export class AgentInstructionsFileFailed extends Schema.TaggedError<AgentInstructionsFileFailed>()(
  "AgentInstructionsFileFailed",
  { operation: Schema.Literals(["read", "write"]), cause: Schema.Defect() },
) {}

interface FoundFile {
  fileName: AgentInstructionFileName;
  path: string;
  size: number;
  mode: number;
}

const fileIo = <A>(operation: "read" | "write", run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new AgentInstructionsFileFailed({ operation, cause }) });

const optionalIo = <A>(run: () => Promise<A>) => fileIo("read", run).pipe(Effect.option);

const findFile = Effect.fn("WorkspaceInstructions.find")(function* (workspace: string) {
  const root = yield* optionalIo(() => realpath(workspace));
  if (Option.isNone(root)) return Option.none<FoundFile>();
  for (const fileName of AGENT_INSTRUCTION_FILE_NAMES) {
    const entry = yield* optionalIo(() => lstat(join(root.value, fileName)));
    if (Option.isNone(entry) || !(entry.value.isFile() || entry.value.isSymbolicLink())) continue;
    const path = entry.value.isFile()
      ? Option.some(join(root.value, fileName))
      : yield* optionalIo(() => realpath(join(root.value, fileName)));
    if (Option.isNone(path)) continue;
    if (!isPathInside(root.value, path.value)) return yield* new AgentInstructionsFileRefused({ reason: "outside" });
    const target = yield* optionalIo(() => lstat(path.value));
    if (Option.isNone(target) || !target.value.isFile()) continue;
    return Option.some<FoundFile>({
      fileName,
      path: path.value,
      size: target.value.size,
      mode: target.value.mode & 0o777,
    });
  }
  return Option.none<FoundFile>();
});

const readStart = (file: FoundFile, limit: number) =>
  fileIo("read", async () => {
    const handle = await open(file.path, "r");
    try {
      const length = Math.min(file.size, limit);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, 0);
      return buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  });

const editorText = Effect.fn("WorkspaceInstructions.editorText")(function* (found: Option.Option<FoundFile>) {
  if (Option.isNone(found)) return "";
  if (found.value.size > AGENT_INSTRUCTIONS_READ_LIMIT)
    return yield* new AgentInstructionsFileRefused({ reason: "too-large" });
  return yield* readStart(found.value, AGENT_INSTRUCTIONS_READ_LIMIT);
});

export const readAgentInstructionsFile = Effect.fn("WorkspaceInstructions.read")(function* (workspace: string) {
  const found = yield* findFile(workspace);
  return {
    fileName: Option.isSome(found) ? found.value.fileName : "AGENTS.md",
    exists: Option.isSome(found),
    text: yield* editorText(found),
  } satisfies AgentInstructionsFile;
});

export const agentInstructionsRevealPath = Effect.fn("WorkspaceInstructions.revealPath")(function* (workspace: string) {
  const found = yield* findFile(workspace);
  return Option.isSome(found) ? found.value.path : workspace;
});

export const saveAgentInstructionsFile = Effect.fn("WorkspaceInstructions.save")(function* (
  workspace: string,
  text: string,
  expected: string,
) {
  const found = yield* findFile(workspace);
  if ((yield* editorText(found)) !== expected) return yield* new AgentInstructionsFileRefused({ reason: "changed" });
  const fileName = Option.isSome(found) ? found.value.fileName : "AGENTS.md";
  const path = Option.isSome(found)
    ? found.value.path
    : join(yield* fileIo("write", () => realpath(workspace)), fileName);
  yield* writeFileAtomically(path, text).pipe(
    Effect.mapError((error) => new AgentInstructionsFileFailed({ operation: "write", cause: error.cause })),
  );
  if (Option.isSome(found) && found.value.mode !== 0o600) {
    const { mode } = found.value;
    yield* fileIo("write", () => chmod(path, mode));
  }
  return { fileName, exists: true, text } satisfies AgentInstructionsFile;
});

export interface PromptInstructionsFile {
  fileName: AgentInstructionFileName;
  text: string;
  truncated: boolean;
  readByCli: boolean;
}

export const AGENT_INSTRUCTIONS_FILE_BYTES = INPUT_LIMITS.agentInstructionsFile * 4;

const cliReadsFile = Effect.fn("WorkspaceInstructions.cliReads")(function* (
  workspace: string,
  file: FoundFile,
  cliReads: readonly AgentInstructionFileName[],
) {
  if (cliReads.includes(file.fileName)) return true;
  for (const fileName of cliReads) {
    const path = yield* optionalIo(() => realpath(join(workspace, fileName)));
    if (Option.isSome(path) && path.value === file.path) return true;
  }
  return false;
});

const entryMissing = (path: string) =>
  fileIo("read", () => lstat(path)).pipe(
    Effect.as(false),
    Effect.catch((failure) => Effect.succeed(isMissingFileError(failure.cause))),
  );

export const missingInstructionFileNames = Effect.fn("WorkspaceInstructions.missing")(function* (workspace: string) {
  const missing: AgentInstructionFileName[] = [];
  for (const fileName of AGENT_INSTRUCTION_FILE_NAMES)
    if (yield* entryMissing(join(workspace, fileName))) missing.push(fileName);
  return missing;
});

export const promptInstructionsFile = Effect.fn("WorkspaceInstructions.prompt")(function* (
  workspace: string,
  cliReads: readonly AgentInstructionFileName[],
) {
  const found = yield* findFile(workspace).pipe(Effect.orElseSucceed(() => Option.none<FoundFile>()));
  if (Option.isNone(found)) return null;
  const limit = INPUT_LIMITS.agentInstructionsFile;
  const bytes = AGENT_INSTRUCTIONS_FILE_BYTES;
  const read = yield* readStart(found.value, bytes).pipe(Effect.option);
  if (Option.isNone(read)) return null;
  const text = read.value.trim();
  return {
    fileName: found.value.fileName,
    text: text.slice(0, limit),
    truncated: text.length > limit || found.value.size > bytes,
    readByCli: yield* cliReadsFile(workspace, found.value, cliReads),
  } satisfies PromptInstructionsFile;
});
