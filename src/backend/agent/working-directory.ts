import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { AgentSummary } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema } from "effect";

export class WorkingDirectoryFailed extends Schema.TaggedError<WorkingDirectoryFailed>()("WorkingDirectoryFailed", {
  cause: Schema.Defect(),
}) {}

export function effectiveWorkingDirectory(agent: Pick<AgentSummary, "workspacePath" | "workingDirectory">): string {
  return agent.workingDirectory ?? agent.workspacePath;
}

export const validateWorkingDirectory = Effect.fn("WorkingDirectory.validate")(function* (path: string) {
  return yield* Effect.tryPromise({
    try: async () => {
      if (!isAbsolute(path) || path.includes("\0")) throw new Error("Invalid directory.");
      const resolved = await realpath(path);
      if (!(await stat(resolved)).isDirectory()) throw new Error("Invalid directory.");
      await access(resolved, constants.R_OK | constants.W_OK | constants.X_OK);
      return resolved;
    },
    catch: () =>
      new WorkingDirectoryFailed({ cause: new Error(sourceText("error.agent.workingDirectoryUnavailable")) }),
  });
});
