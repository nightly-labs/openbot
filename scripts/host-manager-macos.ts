import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, readdir, readlink, rename, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { HostManagerOperations } from "../src/main/host-manager";
import { HOST_MANAGER_DIRECTORY, verifyHostDirectory } from "../src/main/host-update-files";

const exec = promisify(execFile);
export const SHARED_APP = "/Applications/OpenBot.app";
const STAGING = "/Applications/.openbot-host-stage";
const PRIVATE = join(HOST_MANAGER_DIRECTORY, "private");
const SIGNING_REQUIREMENT =
  '=anchor apple generic and identifier "app.openbot.desktop" and certificate leaf[subject.OU] = "ZTRDTUL87R"';
const releaseSchema = z.object({
  tag_name: z.string().regex(/^v?\d+\.\d+\.\d+$/),
  draft: z.literal(false),
  prerelease: z.literal(false),
});

export async function hostCommand(file: string, args: string[], timeout = 60_000): Promise<string> {
  const result = await exec(file, args, {
    timeout,
    maxBuffer: 8 * 1024 * 1024,
    env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
  });
  return result.stdout.trim();
}
const command = hostCommand;

/** The system Applications directory normally permits administrators (group 80) to install apps. */
export async function verifySharedAppParent(): Promise<void> {
  await verifyHostPath("/");
  const info = await lstat("/Applications");
  if (
    !info.isDirectory() ||
    info.uid !== 0 ||
    (info.mode & 0o002) !== 0 ||
    ((info.mode & 0o020) !== 0 && info.gid !== 80)
  )
    throw new Error("Unsafe Applications directory.");
  await verifyNoWriteAcl("/Applications");
}

export async function verifyNoWriteAcl(path: string): Promise<void> {
  const output = await command("/bin/ls", ["-lde", path]);
  if (
    output
      .split("\n")
      .some((line) =>
        /\d+:.*\ballow\b.*\b(write|append|add_file|add_subdirectory|delete|delete_child|writeattr|writeextattr|writesecurity|chown)\b/.test(
          line,
        ),
      )
  ) {
    throw new Error("Writable ACL is not permitted on host paths.");
  }
}

export async function verifyHostPath(path: string): Promise<void> {
  if (resolve(path) === "/Applications") return verifySharedAppParent();
  if (resolve(path) === STAGING) {
    await verifySharedAppParent();
    const info = await lstat(path);
    if (!info.isDirectory() || info.uid !== 0 || (info.mode & 0o022) !== 0)
      throw new Error("Unsafe application staging directory.");
    await verifyNoWriteAcl(path);
    return;
  }
  await verifyHostDirectory(path);
  for (let part = resolve(path); ; part = dirname(part)) {
    await verifyNoWriteAcl(part);
    if (dirname(part) === part) break;
  }
}

export async function ensureHostDirectory(path: string, mode: number): Promise<void> {
  await verifyHostPath(dirname(path));
  try {
    await mkdir(path, { mode });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
  await verifyHostPath(path);
  await chmod(path, mode);
}

/** Only visits the application bundle. Internal framework symlinks are valid; external links are not. */
export async function verifyBundleTree(root: string, requireRootOwner: boolean): Promise<void> {
  const walk = async (path: string): Promise<void> => {
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      const target = resolve(dirname(path), await readlink(path));
      if (!target.startsWith(`${root}${sep}`)) throw new Error("Bundle contains an external symlink.");
      return;
    }
    if (!info.isFile() && !info.isDirectory()) throw new Error("Unexpected bundle file type.");
    if (info.isFile() && info.nlink !== 1) throw new Error("Bundle contains hard-linked files.");
    if (requireRootOwner && (info.uid !== 0 || (info.mode & 0o022) !== 0))
      throw new Error("Bundle is writable by tenants.");
    if (info.isDirectory()) for (const entry of await readdir(path)) await walk(join(path, entry));
  };
  if (!(await lstat(root)).isDirectory()) throw new Error("Application must be a real directory.");
  await walk(root);
  // A single recursive listing checks bundle ACLs without launching a process for every file.
  const acl = await command("/bin/ls", ["-leR", root]);
  if (acl.split("\n").some((line) => /^\s*\d+:.*\ballow\b/.test(line)))
    throw new Error("Bundle has access-granting ACLs.");
}

export async function verifySignature(app: string): Promise<void> {
  await command("/usr/bin/codesign", ["--verify", "--deep", "--strict", "-R", SIGNING_REQUIREMENT, app]);
  await command("/usr/sbin/spctl", ["--assess", "--type", "execute", app]);
}

export async function bundleVersion(app = SHARED_APP): Promise<string> {
  return command("/usr/libexec/PlistBuddy", [
    "-c",
    "Print CFBundleShortVersionString",
    join(app, "Contents/Info.plist"),
  ]);
}

export async function bundleProcesses(): Promise<Array<{ uid: number; pid: number; main: boolean }>> {
  // comm reports executable paths, without workspace paths or prompts in command arguments.
  const output = await command("/bin/ps", ["-axo", "pid=,uid=,comm="]);
  if (!output) throw new Error("Process scan returned no processes.");
  const processes: Array<{ uid: number; pid: number; main: boolean }> = [];
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!match) throw new Error("Invalid process scan.");
    if (match[3].startsWith(`${SHARED_APP}/`))
      processes.push({
        pid: Number(match[1]),
        uid: Number(match[2]),
        main: match[3] === `${SHARED_APP}/Contents/MacOS/OpenBot`,
      });
  }
  return processes;
}

export async function runningOpenBotProcesses(): Promise<Array<{ uid: number; pid: number }>> {
  return (await bundleProcesses()).filter((process) => process.main).map(({ uid, pid }) => ({ uid, pid }));
}

export function macHostOperations(): HostManagerOperations {
  return {
    runningTenants: runningOpenBotProcesses,
    applicationInUse: async () => (await bundleProcesses()).length !== 0,
    installedVersion: async () => {
      await verifyBundleTree(SHARED_APP, true);
      await verifySignature(SHARED_APP);
      return bundleVersion();
    },
    stageLatest: async () => {
      await verifySharedAppParent();
      await verifyBundleTree(SHARED_APP, true);
      await verifySignature(SHARED_APP);
      const response = await fetch("https://api.github.com/repos/nightly-labs/openbot/releases/latest", {
        signal: AbortSignal.timeout(30_000),
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!response.ok) throw new Error("Release lookup failed.");
      const release = releaseSchema.parse(await response.json());
      const version = release.tag_name.replace(/^v/, "");
      const current = await bundleVersion();
      if (!isNewerRelease(version, current)) return null;
      await ensureHostDirectory(PRIVATE, 0o700);
      await ensureHostDirectory(STAGING, 0o700);
      const dmg = join(PRIVATE, "release.dmg");
      await rm(dmg, { force: true });
      // Asset names and repository are fixed. No tenant supplies a network destination.
      const url = `https://github.com/nightly-labs/openbot/releases/download/${release.tag_name}/OpenBot-${version}-arm64.dmg`;
      await command(
        "/usr/bin/curl",
        [
          "--fail",
          "--location",
          "--proto",
          "=https",
          "--proto-redir",
          "=https",
          "--max-time",
          "900",
          "--max-filesize",
          "2147483648",
          "--output",
          dmg,
          url,
        ],
        920_000,
      );
      const mount = join(PRIVATE, "mount");
      await ensureHostDirectory(mount, 0o700);
      await command("/usr/bin/hdiutil", ["attach", dmg, "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", mount]);
      try {
        const source = join(mount, "OpenBot.app");
        await verifyBundleTree(source, false);
        await verifySignature(source);
        if ((await bundleVersion(source)) !== version) throw new Error("Downloaded version mismatch.");
        const staged = join(STAGING, "OpenBot.app");
        await rm(staged, { recursive: true, force: true });
        await command("/usr/bin/ditto", ["--noqtn", source, staged], 180_000);
        await command("/usr/sbin/chown", ["-Rh", "root:wheel", staged]);
        await command("/bin/chmod", ["-RN", staged]);
        await command("/bin/chmod", ["-R", "go-w", staged]);
        await verifyBundleTree(staged, true);
        await verifySignature(staged);
      } finally {
        await command("/usr/bin/hdiutil", ["detach", mount]);
      }
      await rm(dmg);
      return version;
    },
    install: async (version) => {
      await verifySharedAppParent();
      await verifyHostPath(STAGING);
      const staged = join(STAGING, "OpenBot.app");
      await verifyBundleTree(staged, true);
      await verifySignature(staged);
      if ((await bundleVersion(staged)) !== version) throw new Error("Staged version mismatch.");
      if ((await bundleProcesses()).length !== 0) throw new Error("OpenBot restarted during maintenance.");
      const retired = join(STAGING, "retired.app");
      // Only application code moves here, never tenant content. No automatic downgrade.
      await rm(retired, { recursive: true, force: true });
      await rename(SHARED_APP, retired);
      await rename(staged, SHARED_APP);
      await verifyBundleTree(SHARED_APP, true);
      await verifySignature(SHARED_APP);
      if ((await bundleVersion()) !== version) throw new Error("Installed version mismatch.");
      await rm(retired, { recursive: true });
    },
  };
}

export function isNewerRelease(candidate: string, current: string): boolean {
  if (!/^\d+\.\d+\.\d+$/.test(current)) throw new Error("Installed version is not a stable release.");
  const next = candidate.split(".").map(Number);
  const previous = current.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== previous[index]) return next[index] > previous[index];
  }
  return false;
}

export async function openSharedApplication(): Promise<void> {
  await command("/usr/bin/open", ["-a", SHARED_APP]);
}
