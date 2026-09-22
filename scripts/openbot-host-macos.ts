import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, chown, lstat, mkdir, open, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import {
  hostStateSchema,
  isMissingFile,
  HOST_MANAGER_DIRECTORY as ROOT,
  readHostConfig,
  readOwnedJson,
  tenantStatusSchema,
  verifyHostDirectory,
  verifyTenantDirectory,
} from "../src/main/host-update-files";
import {
  HOST_AGENT_PLIST,
  HOST_DAEMON_PLIST,
  HOST_EXECUTABLES,
  HOST_FILES,
  hostExecutableRequirement,
  hostFileMode,
  hostReleaseSchema,
} from "./host-installation";
import {
  bundleProcesses,
  hostCommand,
  isNewerRelease,
  macHostOperations,
  SHARED_APP,
  verifyBundleTree,
  verifyHostPath,
  verifyNoWriteAcl,
  verifySharedAppParent,
  verifySignature,
} from "./host-manager-macos";
import { type HostAdminOperations, type HostTenant, validateHostNames } from "./openbot-host-service";

const exec = promisify(execFile);
const createdSchema = z
  .object({
    credentials: z.array(
      z.object({ username: z.string(), uid: z.number().int().min(501), password: z.string().min(32) }),
    ),
    credentialFile: z.string().regex(/^\/private\/var\/root\/openbot-tenant-credentials-[A-Fa-f0-9-]+\.json$/),
  })
  .strict();

export async function verifyInstalledHostFile(path: string): Promise<void> {
  await verifyHostPath(dirname(path));
  const info = await lstat(path);
  if (
    !info.isFile() ||
    info.nlink !== 1 ||
    info.uid !== 0 ||
    info.gid !== 0 ||
    (info.mode & 0o7777) !== hostFileMode(path)
  )
    throw new Error("Unsafe host artifact.");
  await verifyNoWriteAcl(path);
}

async function verifyInstallation(): Promise<void> {
  for (const path of HOST_FILES) await verifyInstalledHostFile(path);
  for (const name of HOST_EXECUTABLES) {
    await hostCommand("/usr/bin/codesign", [
      "--verify",
      "--strict",
      "--verbose=2",
      "-R",
      hostExecutableRequirement(name),
      join(ROOT, name),
    ]);
  }
  await readOwnedJson(join(ROOT, "host-release.json"), 0, hostReleaseSchema);
  for (const path of [HOST_AGENT_PLIST, HOST_DAEMON_PLIST]) await hostCommand("/usr/bin/plutil", ["-lint", path]);
  if (
    (await hostCommand("/usr/bin/plutil", ["-extract", "UserName", "raw", HOST_DAEMON_PLIST])) !== "root" ||
    (await hostCommand("/usr/bin/plutil", ["-extract", "ProgramArguments.0", "raw", HOST_DAEMON_PLIST])) !==
      join(ROOT, "host-manager") ||
    (await hostCommand("/usr/bin/plutil", ["-extract", "ProgramArguments.0", "raw", HOST_AGENT_PLIST])) !==
      join(ROOT, "openbot-relaunch.sh") ||
    (await hostCommand("/usr/bin/plutil", ["-extract", "LimitLoadToSessionType", "raw", HOST_AGENT_PLIST])) !== "Aqua"
  ) {
    throw new Error("Unexpected launchd definition.");
  }
}

async function verifyApplication(): Promise<void> {
  await verifySharedAppParent();
  const installed = await macHostOperations().installedVersion();
  const release = await readOwnedJson(join(ROOT, "host-release.json"), 0, hostReleaseSchema);
  if (isNewerRelease(release.version, installed))
    throw new Error("Install the matching or a newer OpenBot application first.");
}

async function prepareApplication(): Promise<void> {
  await verifySharedAppParent();
  await verifyBundleTree(SHARED_APP, false);
  await verifySignature(SHARED_APP);
  if (await macHostOperations().applicationInUse()) throw new Error("Quit all OpenBot sessions before initial setup.");
  // A normal DMG copy may belong to its installing administrator. Never adopt a tenant-owned bundle.
  const admins = new Set<number>([0]);
  const checkOwner = async (path: string): Promise<void> => {
    const info = await lstat(path);
    if (!admins.has(info.uid)) {
      const groups = await hostCommand("/usr/bin/id", ["-G", String(info.uid)]);
      if (!groups.split(/\s+/).includes("80")) throw new Error("App bundle must be owned by root or an administrator.");
      admins.add(info.uid);
    }
    if ((info.mode & 0o002) !== 0 && !info.isSymbolicLink()) throw new Error("App bundle is publicly writable.");
    if ((info.mode & 0o020) !== 0 && !info.isSymbolicLink() && info.gid !== 0 && info.gid !== 80)
      throw new Error("App bundle is writable by a non-administrator group.");
    if (info.isDirectory()) for (const entry of await readdir(path)) await checkOwner(join(path, entry));
  };
  await checkOwner(SHARED_APP);
  await hostCommand("/usr/sbin/chown", ["-Rh", "root:wheel", SHARED_APP]);
  await hostCommand("/bin/chmod", ["-R", "-P", "go-w", SHARED_APP]);
  await verifyApplication();
}

export function validateTenantMetadata(input: {
  name: string;
  uid: number;
  groups: string;
  homeAttribute: string;
  owner: number;
  mode: number;
  directory: boolean;
  acl: string;
}): HostTenant {
  const { name, uid } = input;
  validateHostNames([name]);
  if (!Number.isInteger(uid) || uid < 501 || input.groups.split(/\s+/).includes("80"))
    throw new Error("Tenant must be a Standard user.");
  if (
    input.homeAttribute !== `NFSHomeDirectory: /Users/${name}` ||
    !input.directory ||
    input.owner !== uid ||
    (input.mode & 0o7777) !== 0o700
  )
    throw new Error("Tenant home must be private, owned by its user and mode 0700.");
  if (/^\s*\d+:.*\ballow\b/m.test(input.acl)) throw new Error("Tenant home has an access-granting ACL.");
  return { name, uid };
}

async function inspectTenant(name: string): Promise<HostTenant> {
  validateHostNames([name]);
  const uid = Number(await hostCommand("/usr/bin/id", ["-u", name]));
  const groups = await hostCommand("/usr/bin/id", ["-G", name]);
  const home = `/Users/${name}`;
  const homeAttribute = await hostCommand("/usr/bin/dscl", [".", "-read", `/Users/${name}`, "NFSHomeDirectory"]);
  const info = await lstat(home);
  const acl = await hostCommand("/bin/ls", ["-lde", home]);
  return validateTenantMetadata({
    name,
    uid,
    groups,
    homeAttribute,
    owner: info.uid,
    mode: info.mode,
    directory: info.isDirectory(),
    acl,
  });
}

async function verifyIsolation(tenants: HostTenant[]): Promise<void> {
  await verifyHostPath(ROOT);
  const directory = join(ROOT, `.verify-${randomUUID()}`);
  await mkdir(directory, { mode: 0o755 });
  await chmod(directory, 0o755);
  try {
    for (const tenant of tenants) {
      const area = join(directory, String(tenant.uid));
      await mkdir(area, { mode: 0o700 });
      await writeFile(join(area, "probe"), "OpenBot permission test\n", { flag: "wx", mode: 0o600 });
      await chown(join(area, "probe"), tenant.uid, 20);
      await chown(area, tenant.uid, 20);
    }
    for (const owner of tenants)
      for (const reader of tenants) {
        const same = owner.uid === reader.uid;
        // Only harmless files in the root-created verification area are accessed. No tenant content.
        await hostCommand("/usr/bin/sudo", [
          "-n",
          "-u",
          `#${reader.uid}`,
          "-g",
          "#20",
          "--",
          "/bin/sh",
          "-c",
          same ? 'test -r "$1" && test -w "$1"' : '! test -r "$1" && ! test -w "$1" && ! test -w "$2"',
          "verify",
          join(directory, String(owner.uid), "probe"),
          join(directory, String(owner.uid)),
        ]);
      }
  } finally {
    await rm(directory, { recursive: true });
  }
}

export function macHostAdminOperations(): HostAdminOperations {
  let credentialFile: string | null = null;
  // Account names do not change while one command runs, and watch would otherwise rescan on each refresh.
  const names = new Map<number, string>();
  return {
    verifyInstallation,
    verifyApplication,
    prepareApplication,
    inspectTenant,
    verifyIsolation,
    readConfig: async () => {
      const config = await readHostConfig();
      if (config) await verifyNoWriteAcl(join(ROOT, "config.json"));
      return config;
    },
    checkNewUsers: async (names) => {
      if (!names.length) return;
      // This lists only local account names. The native tool repeats directory-service preflight.
      const existing = (await hostCommand("/usr/bin/dscl", [".", "-list", "/Users"])).split("\n");
      for (const name of names) {
        if (existing.includes(name)) throw new Error("Requested account already exists.");
        try {
          await lstat(`/Users/${name}`);
        } catch (error) {
          if (isMissingFile(error)) continue;
          throw error;
        }
        throw new Error("Requested home already exists.");
      }
    },
    createUsers: async (names) => {
      // Capture sensitive output in memory. Never print an exec error, stdout or stderr.
      let result: string;
      try {
        result = (
          await exec(join(ROOT, "create-tenants"), ["--json", ...names], {
            env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
            timeout: 120_000,
            maxBuffer: 128 * 1024,
          })
        ).stdout;
      } catch {
        throw new Error("Account creation stopped. Preserve any root-only credential file for recovery.");
      }
      const created = createdSchema.parse(JSON.parse(result));
      credentialFile = created.credentialFile;
      if (
        created.credentials.length !== names.length ||
        created.credentials.some((item, index) => item.username !== names[index])
      )
        throw new Error("Account creation returned an unexpected result.");
      return created.credentials.map(({ username: name, uid, password }) => ({ name, uid, password }));
    },
    register: async (uids) => {
      await hostCommand(join(ROOT, "host-manager"), ["--setup", ...uids.map(String)]);
    },
    startJobs: async (tenants) => {
      await hostCommand("/bin/launchctl", ["bootstrap", "system", HOST_DAEMON_PLIST]);
      for (const tenant of tenants) {
        try {
          await hostCommand("/bin/launchctl", ["print", `gui/${tenant.uid}`]);
        } catch {
          continue;
        } // Logged-out users load the global Aqua agent at next GUI login.
        try {
          await hostCommand("/bin/launchctl", ["print", `gui/${tenant.uid}/app.openbot.desktop.relaunch`]);
        } catch {
          await hostCommand("/bin/launchctl", ["bootstrap", `gui/${tenant.uid}`, HOST_AGENT_PLIST]);
        }
      }
    },
    presentCredentials: async (credentials) => {
      if (!credentials.length) return;
      // /dev/tty avoids stdout redirection, pipes, service logs and diagnostic collectors.
      const terminal = await open("/dev/tty", "w");
      try {
        await terminal.writeFile(
          `Save these passwords now:\n${credentials.map((item) => `${item.name}: ${item.password}`).join("\n")}\n`,
        );
      } finally {
        await terminal.close();
      }
      if (credentialFile) {
        const info = await lstat(credentialFile);
        if (!info.isFile() || info.uid !== 0 || info.nlink !== 1 || (info.mode & 0o777) !== 0o600)
          throw new Error("Unsafe credential recovery file.");
        await unlink(credentialFile);
      }
    },
    tenantForUid: async (uid) => {
      const cached = names.get(uid);
      if (cached !== undefined) return { uid, name: cached };
      const name = await hostCommand("/usr/bin/id", ["-un", String(uid)]);
      names.set(uid, name);
      return { uid, name };
    },
    bundleProcesses,
    readState: async () => {
      try {
        await verifyHostDirectory(ROOT);
        return await readOwnedJson(join(ROOT, "state.json"), 0, hostStateSchema);
      } catch (error) {
        if (isMissingFile(error)) return null;
        throw error;
      }
    },
    readTenantStatus: async (uid) => {
      // A logged-out, stopped or malformed tenant is a normal reading, not a command failure.
      try {
        const directory = await verifyTenantDirectory(ROOT, uid);
        const status = await readOwnedJson(join(directory, "status.json"), uid, tenantStatusSchema);
        // The host ignores a report that claims another UID. Never show it as that tenant's state.
        return status.uid === uid ? status : null;
      } catch {
        return null;
      }
    },
    verifyState: async () => {
      await verifyHostPath(ROOT);
      await readOwnedJson(join(ROOT, "state.json"), 0, hostStateSchema);
      await verifyNoWriteAcl(join(ROOT, "state.json"));
    },
    verifyDaemon: async () => {
      const output = await hostCommand("/bin/launchctl", ["print", "system/app.openbot.host-manager"]);
      if (!/^\s*state = running\s*$/m.test(output) || !/^\s*pid = \d+\s*$/m.test(output))
        throw new Error("Host daemon is not running.");
    },
  };
}

export async function withHostSetupLock(run: () => Promise<void>): Promise<void> {
  await verifyHostPath(ROOT);
  const lock = join(ROOT, "setup-in-progress");
  await mkdir(lock, { mode: 0o700 });
  try {
    await run();
  } finally {
    await rm(lock, { recursive: true });
  }
}
