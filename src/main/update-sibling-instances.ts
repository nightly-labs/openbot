import { execFile } from "node:child_process";
import { sourceText } from "@openbot/i18n/source";

/**
 * Another OpenBot process running from the same application bundle. On a Mac shared by several
 * macOS users this is how one tenant finds the others: the bundle is shared, the network
 * namespace is shared, and replacing the bundle under a live session breaks it.
 */
export interface OpenBotSiblingInstance {
  pid: number;
  uid: number;
}

interface SiblingScanInput {
  executablePath: string;
  currentPid: number;
  platform?: NodeJS.Platform;
  listProcesses?: () => Promise<string>;
}

/**
 * Lists other processes running this exact application executable. The single-instance lock
 * already rules out a second process for the same macOS user, so every match is effectively
 * another tenant's session; the uid is reported so the refusal can say so.
 *
 * A failed scan blocks installation: failure is not proof that the shared bundle is unused.
 */
export async function listSiblingOpenBotInstances(input: SiblingScanInput): Promise<OpenBotSiblingInstance[]> {
  const platform = input.platform ?? process.platform;
  if (platform !== "darwin" && platform !== "linux") return [];
  const output = await (input.listProcesses ?? (() => listProcessesWithPs(platform)))();
  return parseSiblingInstances(output, input);
}

export function parseSiblingInstances(
  output: string,
  input: Pick<SiblingScanInput, "executablePath" | "currentPid">,
): OpenBotSiblingInstance[] {
  const siblings: OpenBotSiblingInstance[] = [];
  if (!input.executablePath.trim()) return siblings;
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    const uid = Number(match[2]);
    const command = match[3] ?? "";
    if (pid === input.currentPid) continue;
    if (command !== input.executablePath && !command.startsWith(`${input.executablePath} `)) continue;
    siblings.push({ pid, uid });
  }
  return siblings;
}

function listProcessesWithPs(platform: NodeJS.Platform): Promise<string> {
  return new Promise((resolve, reject) => {
    // macOS comm is the executable path; Linux comm is only a truncated name.
    const columns = platform === "darwin" ? "pid=,uid=,comm=" : "pid=,uid=,args=";
    execFile("/bin/ps", ["-ax", "-o", columns], (error, stdout) => {
      if (error) reject(new Error(sourceText("error.update.siblingCheckFailed")));
      else resolve(stdout);
    });
  });
}
