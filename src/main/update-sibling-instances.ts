import { execFile } from "node:child_process";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema } from "effect";

export class SiblingScanFailed extends Schema.TaggedError<SiblingScanFailed>()("SiblingScanFailed", {
  cause: Schema.Defect(),
}) {}

export interface OpenBotSiblingInstance {
  pid: number;
  uid: number;
}

interface SiblingScanInput {
  executablePath: string;
  currentPid: number;
  excludedPids?: () => ReadonlySet<number>;
  platform?: NodeJS.Platform;
  listProcesses?: () => Effect.Effect<string, SiblingScanFailed>;
}

export function listSiblingOpenBotInstances(
  input: SiblingScanInput,
): Effect.Effect<OpenBotSiblingInstance[], SiblingScanFailed> {
  return Effect.suspend(() => {
    const platform = input.platform ?? process.platform;
    if (platform !== "darwin") return Effect.succeed([]);
    return (input.listProcesses ?? listProcessesWithPs)().pipe(
      Effect.map((output) => parseSiblingInstances(output, input)),
    );
  });
}

function parseSiblingInstances(
  output: string,
  input: Pick<SiblingScanInput, "executablePath" | "currentPid" | "excludedPids">,
): OpenBotSiblingInstance[] {
  const siblings: OpenBotSiblingInstance[] = [];
  const excluded = input.excludedPids?.() ?? new Set<number>();
  if (!input.executablePath.trim()) return siblings;
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    const uid = Number(match[2]);
    const command = match[3] ?? "";
    if (pid === input.currentPid || excluded.has(pid)) continue;
    if (command !== input.executablePath && !command.startsWith(`${input.executablePath} `)) continue;
    siblings.push({ pid, uid });
  }
  return siblings;
}

function listProcessesWithPs(): Effect.Effect<string, SiblingScanFailed> {
  return Effect.callback<string, SiblingScanFailed>((resume) => {
    execFile("/bin/ps", ["-ax", "-o", "pid=,uid=,comm="], (error, stdout) => {
      if (error) {
        resume(Effect.fail(new SiblingScanFailed({ cause: new Error(sourceText("error.update.siblingCheckFailed")) })));
      } else resume(Effect.succeed(stdout));
    });
  });
}
