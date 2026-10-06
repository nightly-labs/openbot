import { existsSync } from "node:fs";
import { join } from "node:path";

export function resolvePackageBin(root: string, name: string): string {
  const binDir = join(root, "node_modules", ".bin");
  if (process.platform === "win32") {
    const exe = join(binDir, `${name}.exe`);
    if (existsSync(exe)) return exe;
    const cmd = join(binDir, `${name}.cmd`);
    if (existsSync(cmd)) return cmd;
  }
  return join(binDir, name);
}
