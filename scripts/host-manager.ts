import { chown, lstat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { HostManager } from "../src/main/host-manager";
import {
  HOST_MANAGER_DIRECTORY,
  HOST_POLL_MS,
  hostConfigSchema,
  readHostConfig,
  writeProtocolJson,
} from "../src/main/host-update-files";
import { relaunchManagedTenant } from "../src/main/host-update-relaunch";
import {
  ensureHostDirectory,
  macHostOperations,
  openSharedApplication,
  verifyHostPath,
  verifySharedAppParent,
} from "./host-manager-macos";

async function main(): Promise<void> {
  if (process.argv[2] === "--help") {
    process.stdout.write("OpenBot Host Manager: run through launchd; administrator setup uses openbot-host.\n");
    return;
  }
  if (process.argv[2] === "--runtime-check") {
    // Exercise JavaScriptCore's hot loop in the hardened standalone executable without host access.
    let sum = 0;
    for (let index = 0; index < 1_000_000; index++) sum += index;
    if (sum !== 499_999_500_000) throw new Error("Runtime check failed.");
    process.stdout.write("Standalone runtime passed.\n");
    return;
  }
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new Error("Host Manager requires an Apple Silicon Mac.");
  const uid = process.getuid?.();
  if (process.argv[2] === "--relaunch" && process.argv.length === 3 && uid !== undefined && uid >= 501) {
    await relaunchManagedTenant(uid, { ...macHostOperations(), open: openSharedApplication });
    return;
  }
  if (uid !== 0) throw new Error("Host maintenance requires root.");
  const directory = HOST_MANAGER_DIRECTORY;
  if (process.argv[2] === "--setup") {
    const tenants = process.argv.slice(3).map((uid) => (/^\d+$/.test(uid) ? Number(uid) : NaN));
    const config = hostConfigSchema.parse({ managed: true, tenants });
    await verifySharedAppParent();
    await macHostOperations().installedVersion();
    await ensureHostDirectory("/Library/Application Support/OpenBot", 0o755);
    await ensureHostDirectory(directory, 0o755);
    if (await readHostConfig())
      throw new Error(
        "Host configuration already exists. Stop the daemon before an administrator changes registration.",
      );
    await ensureHostDirectory(join(directory, "tenants"), 0o755);
    for (const uid of config.tenants) {
      const path = join(directory, "tenants", String(uid));
      // Never repair or follow an existing tenant-controlled path as root.
      await mkdir(path, { mode: 0o700 });
      await chown(path, uid, 0);
      const info = await lstat(path);
      if (info.uid !== uid || !info.isDirectory()) throw new Error("Tenant directory setup failed.");
    }
    await writeProtocolJson(join(directory, "state.json"), {
      phase: "idle",
      cycle: "",
      version: null,
      updatedAt: Date.now(),
      error: null,
    });
    await writeProtocolJson(join(directory, "config.json"), config);
    return;
  }
  // launchd owns daemon lifetime and serialization. Do not allow a second interactive coordinator.
  if (process.ppid !== 1 || process.argv.length !== 2)
    throw new Error("Start Host Manager through its system LaunchDaemon.");
  await verifyHostPath(directory);
  const manager = new HostManager(directory, macHostOperations());
  const run = (): void => {
    void manager.tick().catch(() => {
      process.stderr.write("Host Manager control write failed. Check root-owned host paths.\n");
      process.exit(1);
    });
  };
  run();
  setInterval(run, HOST_POLL_MS);
}

void main().catch(() => {
  process.stderr.write("Host Manager failed. Check host configuration, ownership and LaunchDaemon installation.\n");
  process.exitCode = 1;
});
