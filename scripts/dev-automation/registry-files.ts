import { execFileSync } from "node:child_process";
import { chmodSync, closeSync, lstatSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";

export interface DirectoryOwnership {
  uid: number;
  mode: number;
  symbolicLink: boolean;
}

export function assertOwnerOnlyDirectory(
  directory: string,
  stats: DirectoryOwnership,
  owner = process.getuid?.(),
): void {
  if (stats.symbolicLink || (owner !== undefined && stats.uid !== owner)) {
    throw new Error(
      `${directory} is not owned by this user, so dev instances will not be published there. ` +
        "Remove it and start `bun run dev` again.",
    );
  }
  if ((stats.mode & 0o077) !== 0) {
    throw new Error(
      `${directory} is accessible to other accounts (mode ${(stats.mode & 0o777).toString(8)}). ` +
        "Remove it and start `bun run dev` again: a registry another account can write lets it choose " +
        "which app an automation command drives.",
    );
  }
}

const WINDOWS_ADMINISTRATORS_SID = "S-1-5-32-544";
const WINDOWS_TRUSTED_WRITER_SIDS = [WINDOWS_ADMINISTRATORS_SID, "S-1-5-18", "S-1-3-0"];

const WINDOWS_WRITE_RIGHTS = "0x500D0156";

function assertWindowsOwnerOnlyDirectory(directory: string): void {
  let lines: string[];
  try {
    lines = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$sid = [System.Security.Principal.SecurityIdentifier]; " +
          "$acl = Get-Acl -LiteralPath $env:OPENBOT_REGISTRY_DIRECTORY; " +
          "$acl.GetOwner($sid).Value; " +
          "[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; " +
          "$acl.GetAccessRules($true, $true, $sid) | Where-Object { " +
          "$_.AccessControlType -eq 'Allow' -and " +
          `([int]$_.FileSystemRights -band ${WINDOWS_WRITE_RIGHTS}) } | ForEach-Object { $_.IdentityReference.Value }`,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, OPENBOT_REGISTRY_DIRECTORY: directory },
        timeout: 5_000,
        stdio: ["ignore", "pipe", "ignore"],
      },
    )
      .trim()
      .split(/\s+/);
  } catch (error) {
    throw new Error(
      `Could not read the permissions of ${directory}, so dev instances will not be published there. ` +
        "Remove it and start `bun run dev` again.",
      { cause: error },
    );
  }
  const [owner, currentUser, ...writers] = lines;
  if (!owner || !currentUser || (owner !== currentUser && owner !== WINDOWS_ADMINISTRATORS_SID)) {
    throw new Error(
      `${directory} is not owned by this user, so dev instances will not be published there. ` +
        "Remove it and start `bun run dev` again.",
    );
  }
  const otherWriters = writers.filter((sid) => sid !== currentUser && !WINDOWS_TRUSTED_WRITER_SIDS.includes(sid));
  if (otherWriters.length > 0) {
    throw new Error(
      `${directory} is writable by other accounts (${otherWriters.join(", ")}). ` +
        "Remove it and start `bun run dev` again: a registry another account can write lets it choose " +
        "which app an automation command drives.",
    );
  }
}

export function assertRegistryDirectoryOwnership(directory: string): void {
  const stats = lstatSync(directory);
  if (process.platform === "win32") {
    if (stats.isSymbolicLink()) {
      throw new Error(
        `${directory} is not owned by this user, so dev instances will not be published there. ` +
          "Remove it and start `bun run dev` again.",
      );
    }
    assertWindowsOwnerOnlyDirectory(directory);
    return;
  }
  assertOwnerOnlyDirectory(directory, {
    uid: stats.uid,
    mode: stats.mode,
    symbolicLink: stats.isSymbolicLink(),
  });
}

export function ensureOwnerOnlyDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    chmodSync(directory, 0o700);
  } catch {}
  assertRegistryDirectoryOwnership(directory);
}

export function writeRegistryFile(target: string, contents: string): void {
  const staging = `${target}.${process.pid}.tmp`;
  rmSync(staging, { force: true });
  const handle = openSync(staging, "wx", 0o600);
  try {
    writeFileSync(handle, contents, "utf8");
  } finally {
    closeSync(handle);
  }
  renameSync(staging, target);
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const PROCESS_START_GRACE_MS = 2_000;

export function isRecordedProcess(record: { startedAt: number }, processStartedAt: number | null): boolean {
  if (processStartedAt === null) return true;
  return processStartedAt <= record.startedAt + PROCESS_START_GRACE_MS;
}

export function readProcessStartedAt(pid: number): number | null {
  if (process.platform === "win32") return readWindowsProcessStartedAt(pid);
  try {
    const reported = execFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
      encoding: "utf8",
      timeout: 2_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const parsed = Date.parse(reported);
    return Number.isNaN(parsed) ? null : parsed;
  } catch {
    return null;
  }
}

export function isLiveRecordedProcess(entry: { pid: number; startedAt: number }): boolean {
  if (!isProcessAlive(entry.pid)) return false;
  return isRecordedProcess(entry, readProcessStartedAt(entry.pid));
}

function readWindowsProcessStartedAt(pid: number): number | null {
  try {
    const reported = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().ToString('o')`,
      ],
      { encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    const parsed = Date.parse(reported);
    return Number.isNaN(parsed) ? null : parsed;
  } catch {
    return null;
  }
}

export type RecordedProcessState = "live" | "gone" | "unverified";

export function verifyRecordedProcess(
  entry: { pid: number; startedAt: number },
  readStartedAt: (pid: number) => number | null = readProcessStartedAt,
): RecordedProcessState {
  if (!isProcessAlive(entry.pid)) return "gone";
  const startedAt = readStartedAt(entry.pid);
  if (startedAt === null) return "unverified";
  return isRecordedProcess(entry, startedAt) ? "live" : "gone";
}

function hasWindowsChildProcess(pid: number): boolean {
  try {
    const reported = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$parent = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; ` +
          `$children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = ${pid}"); ` +
          "if ($parent) { $children = @($children | Where-Object { $_.CreationDate -lt $parent.CreationDate }) }; " +
          "$children.Count",
      ],
      { encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return Number(reported) > 0;
  } catch {
    return false;
  }
}

export function isProcessGroupAlive(pid: number, platform: NodeJS.Platform = process.platform): boolean {
  if (platform === "win32") return hasWindowsChildProcess(pid);
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}
