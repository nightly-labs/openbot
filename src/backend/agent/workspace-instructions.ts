// The instruction file at the root of an agent's workspace: `AGENTS.md`, or `CLAUDE.md` in an older
// workspace. The user edits it in the agent's settings, and the agent keeps its standing rules in it.

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
import { isPathInside } from "../path-containment";

/**
 * The file is larger than the editor reads, it links to a place outside the workspace, or its text
 * changed after the editor read it.
 */
export class AgentInstructionsFileRefused extends Schema.TaggedError<AgentInstructionsFileRefused>()(
  "AgentInstructionsFileRefused",
  { reason: Schema.Literals(["too-large", "outside", "changed"]) },
) {}

/** The native cause stays here; callers must not export it without redaction. */
export class AgentInstructionsFileFailed extends Schema.TaggedError<AgentInstructionsFileFailed>()(
  "AgentInstructionsFileFailed",
  { operation: Schema.Literals(["read", "write"]), cause: Schema.Defect() },
) {}

interface FoundFile {
  fileName: AgentInstructionFileName;
  /** The real path. A link can name a file in a folder of the workspace. */
  path: string;
  size: number;
  /** The permission bits, which a save keeps. */
  mode: number;
}

const fileIo = <A>(operation: "read" | "write", run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new AgentInstructionsFileFailed({ operation, cause }) });

/** A missing name counts as no file. */
const optionalIo = <A>(run: () => Promise<A>) => fileIo("read", run).pipe(Effect.option);

/**
 * The first instruction file in the workspace. A folder with the name is not a file. A link that
 * goes outside the workspace is refused: the editor must not write through it to a file of the user.
 */
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

/** At most `limit` bytes from the start of the file. */
const readStart = (file: FoundFile, limit: number) =>
  fileIo("read", async () => {
    const handle = await open(file.path, "r");
    try {
      // The file can grow after `findFile`; the text stops at the size it had then.
      const length = Math.min(file.size, limit);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, 0);
      return buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  });

/** The whole text of a file that the editor can show. */
const editorText = Effect.fn("WorkspaceInstructions.editorText")(function* (found: Option.Option<FoundFile>) {
  if (Option.isNone(found)) return "";
  if (found.value.size > AGENT_INSTRUCTIONS_READ_LIMIT)
    return yield* new AgentInstructionsFileRefused({ reason: "too-large" });
  return yield* readStart(found.value, AGENT_INSTRUCTIONS_READ_LIMIT);
});

/** The file for the editor. With no file, the editor shows an empty `AGENTS.md`, which a save creates. */
export const readAgentInstructionsFile = Effect.fn("WorkspaceInstructions.read")(function* (workspace: string) {
  const found = yield* findFile(workspace);
  return {
    fileName: Option.isSome(found) ? found.value.fileName : "AGENTS.md",
    exists: Option.isSome(found),
    text: yield* editorText(found),
  } satisfies AgentInstructionsFile;
});

/**
 * Replaces the text of the first instruction file, or creates `AGENTS.md`. The file keeps its
 * permission bits; a new file is readable only by the user. An empty text keeps an empty file: a
 * save never deletes the file. The save is refused when the text is not `expected` now, because the
 * agent changed the file after the editor read it. A change between this check and the write is
 * still possible, but the window is short.
 */
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

/** The instruction file as the prompt carries it. */
export interface PromptInstructionsFile {
  fileName: AgentInstructionFileName;
  text: string;
  /** The file was longer than the prompt carries. */
  truncated: boolean;
}

/**
 * The file for the prompt, trimmed and cut at the editor limit. An empty file keeps its name. A file
 * that cannot be read, or a link outside the workspace, gives none: the workspace belongs to the
 * agent, and its session must still start.
 */
export const promptInstructionsFile = Effect.fn("WorkspaceInstructions.prompt")(function* (workspace: string) {
  const found = yield* findFile(workspace).pipe(Effect.orElseSucceed(() => Option.none<FoundFile>()));
  if (Option.isNone(found)) return null;
  const limit = INPUT_LIMITS.agentInstructionsFile;
  // A UTF-8 character takes at most 4 bytes, so these bytes hold more than `limit` characters.
  const bytes = limit * 4;
  const read = yield* readStart(found.value, bytes).pipe(Effect.option);
  if (Option.isNone(read)) return null;
  const text = read.value.trim();
  return {
    fileName: found.value.fileName,
    text: text.slice(0, limit),
    truncated: text.length > limit || found.value.size > bytes,
  } satisfies PromptInstructionsFile;
});
