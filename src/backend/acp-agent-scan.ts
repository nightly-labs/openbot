// Which known ACP agents are installed on this computer.
//
// The scan looks for the preset command names, and for nothing else: a file in a folder the user
// listed is found only when its name is a preset's. Nothing is started, not even with `--version`,
// so the scan cannot run an unknown file.

import { homedir } from "node:os";
import { join } from "node:path";
import {
  ACP_AGENT_PRESETS,
  type AcpAgentPreset,
  type DetectedAcpAgent,
  isNewCustomAgentId,
} from "@openbot/contracts/ipc";
import { resolveAgentCommand } from "./acp-agent-command";
import { withTimeout } from "./with-timeout";

export const AGENT_SCAN_TIMEOUT_MS = 10_000;
const AGENT_SCAN_CONCURRENCY = 4;

export interface ScanAcpAgentsOptions {
  /** Extra folders from the detection settings: absolute, or `~/…`. They are searched first. */
  folders: readonly string[];
  /** Custom agent ids in use, so a suggested id is free. */
  takenIds: ReadonlySet<string>;
  presets?: readonly AcpAgentPreset[];
  platform?: NodeJS.Platform;
  home?: string;
  timeoutMs?: number;
  resolve?: typeof resolveAgentCommand;
}

/** One row for each preset that is installed, in preset order. A scan past its time finds nothing. */
export async function scanAcpAgents(options: ScanAcpAgentsOptions): Promise<DetectedAcpAgent[]> {
  const presets = options.presets ?? ACP_AGENT_PRESETS;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const resolve = options.resolve ?? resolveAgentCommand;
  const folders = options.folders.flatMap((folder) => {
    if (folder === "~") return [home];
    if (folder.startsWith("~/")) return [join(home, folder.slice(2))];
    return [folder];
  });
  // On Windows an npm folder holds an extensionless shell script next to the `.cmd` shim, and only
  // the shim or an `.exe` can be started.
  const names = (command: string) => (platform === "win32" ? [`${command}.exe`, `${command}.cmd`] : [command]);
  const find = async (preset: AcpAgentPreset): Promise<string | null> => {
    if (folders.length > 0) {
      for (const name of names(preset.command)) {
        const found = await resolve(name, { platform, home, searchPath: folders }).catch(() => null);
        if (found) return found;
      }
    }
    return resolve(preset.command, { platform, home }).catch(() => null);
  };
  const found = await withTimeout(
    inPool(presets, AGENT_SCAN_CONCURRENCY, find),
    options.timeoutMs ?? AGENT_SCAN_TIMEOUT_MS,
    "",
  ).catch(() => presets.map(() => null));
  const taken = new Set(options.takenIds);
  const seen = new Set<string>();
  const rows: DetectedAcpAgent[] = [];
  presets.forEach((preset, index) => {
    const command = found[index];
    if (!command || seen.has(command)) return;
    seen.add(command);
    const id = freeId(preset.id, taken);
    if (!id) return;
    taken.add(id);
    rows.push({ id, name: preset.name, command, args: [...preset.args] });
  });
  return rows;
}

function freeId(base: string, taken: ReadonlySet<string>): string | null {
  for (let suffix = 1; suffix <= 99; suffix += 1) {
    const id = suffix === 1 ? base : `${base}-${suffix}`;
    if (!taken.has(id) && isNewCustomAgentId(id)) return id;
  }
  return null;
}

/** `work` for each item, at most `limit` at a time, with the results in item order. */
async function inPool<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (let index = next; index < items.length; index = next) {
      next += 1;
      const item = items[index];
      if (item !== undefined) results[index] = await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
