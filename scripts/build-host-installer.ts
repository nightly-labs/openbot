import { execFile } from "node:child_process";
import { chmod, copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { HOST_MANAGER_DIRECTORY } from "../src/main/host-update-files";
import {
  HOST_EXECUTABLES,
  HOST_FILES,
  HOST_PACKAGE_ID,
  HOST_TEAM_ID,
  hostExecutableRequirement,
  hostFileMode,
} from "./host-installation";
import { expectedHostPaths, verifyHostInstaller } from "./verify-host-installer";

const exec = promisify(execFile);
async function command(file: string, args: string[]): Promise<string> {
  const { stdout, stderr } = await exec(file, args, { timeout: 600_000, maxBuffer: 8 * 1024 * 1024 });
  return `${stdout}${stderr}`;
}
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}; unsigned Host packages are never release artifacts.`);
  return value;
}

async function build(): Promise<void> {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Build on Apple Silicon macOS.");
  const version = z
    .object({ version: z.string().regex(/^\d+\.\d+\.\d+$/) })
    .parse(JSON.parse(await readFile("package.json", "utf8"))).version;
  if (required("RELEASE_VERSION") !== version || required("GITHUB_REF_NAME") !== `v${version}`)
    throw new Error("Release tag/version mismatch.");
  const commit = (await command("/usr/bin/git", ["rev-parse", "HEAD"])).trim();
  if (commit !== required("GITHUB_SHA")) throw new Error("Host package must use the tagged release commit.");
  const identity = required("HOST_APPLICATION_IDENTITY");
  const installer = required("HOST_INSTALLER_IDENTITY");
  const keychain = required("HOST_SIGNING_KEYCHAIN");
  if (
    !identity.startsWith("Developer ID Application:") ||
    !installer.startsWith("Developer ID Installer:") ||
    ![identity, installer].every((name) => name.endsWith(`(${HOST_TEAM_ID})`))
  )
    throw new Error("Wrong host signing identities.");
  const appVersion = (
    await command("/usr/libexec/PlistBuddy", [
      "-c",
      "Print CFBundleShortVersionString",
      "dist/mac-arm64/OpenBot.app/Contents/Info.plist",
    ])
  ).trim();
  if (appVersion !== version) throw new Error("OpenBot.app and Host package versions differ.");
  const temp = await mkdtemp(join(tmpdir(), "openbot-host-build-"));
  const payload = join(temp, "payload");
  const installerScripts = join(temp, "scripts");
  const destination = resolve(`dist/OpenBot-Host-${version}-arm64.pkg`);
  try {
    await mkdir(join(payload, HOST_MANAGER_DIRECTORY), { recursive: true });
    for (const name of ["host-manager", "openbot-host"]) {
      await command("bun", [
        "build",
        `scripts/${name}.ts`,
        "--compile",
        "--target=bun-darwin-arm64",
        "--outfile",
        join(payload, HOST_MANAGER_DIRECTORY, name),
      ]);
    }
    await command("/usr/bin/xcrun", [
      "swiftc",
      "-O",
      "-parse-as-library",
      "-target",
      "arm64-apple-macos13",
      "scripts/macos-tenant-setup.swift",
      "-o",
      join(payload, HOST_MANAGER_DIRECTORY, "create-tenants"),
    ]);
    for (const name of HOST_EXECUTABLES) {
      const binary = join(payload, HOST_MANAGER_DIRECTORY, name);
      if (!(await command("/usr/bin/file", [binary])).includes("Mach-O 64-bit executable arm64"))
        throw new Error("Incorrect host executable architecture.");
      await command("/usr/bin/codesign", [
        "--force",
        "--sign",
        identity,
        "--keychain",
        keychain,
        "--timestamp",
        "--options",
        "runtime",
        "--identifier",
        `app.openbot.host.${name}`,
        ...(name === "create-tenants" ? [] : ["--entitlements", "build/macos/host-updates/entitlements.plist"]),
        binary,
      ]);
      await command("/usr/bin/codesign", [
        "--verify",
        "--strict",
        "--verbose=2",
        "-R",
        hostExecutableRequirement(name),
        binary,
      ]);
    }
    for (const [source, target] of [
      ["openbot-host", "/usr/local/bin/openbot-host"],
      ["openbot-relaunch.sh", `${HOST_MANAGER_DIRECTORY}/openbot-relaunch.sh`],
      ["app.openbot.host-manager.plist", "/Library/LaunchDaemons/app.openbot.host-manager.plist"],
      ["app.openbot.desktop.relaunch.plist", "/Library/LaunchAgents/app.openbot.desktop.relaunch.plist"],
    ] as const) {
      await mkdir(dirname(join(payload, target)), { recursive: true });
      await copyFile(`build/macos/host-updates/${source}`, join(payload, target));
    }
    await writeFile(
      join(payload, HOST_MANAGER_DIRECTORY, "host-release.json"),
      `${JSON.stringify({ version, commit, arch: "arm64" })}\n`,
    );
    // Only fixed payload artifacts enter the package. No config, state, home, source or dependencies.
    for (const path of HOST_FILES) await chmod(join(payload, path), hostFileMode(path));
    for (const path of expectedHostPaths()) {
      if (!HOST_FILES.some((file) => `.${file}` === path)) await chmod(join(payload, path), 0o755);
    }
    await mkdir(installerScripts);
    for (const script of ["preinstall", "postinstall"]) {
      await copyFile(`build/macos/host-updates/${script}`, join(installerScripts, script));
      await chmod(join(installerScripts, script), 0o755);
    }
    await command("/usr/bin/pkgbuild", [
      "--root",
      payload,
      "--scripts",
      installerScripts,
      "--identifier",
      HOST_PACKAGE_ID,
      "--version",
      version,
      "--install-location",
      "/",
      "--ownership",
      "recommended",
      "--sign",
      installer,
      "--keychain",
      keychain,
      destination,
    ]);
    await verifyHostInstaller(destination, version, false);
    await rm("dist/host-sbom", { recursive: true, force: true });
    await cp(payload, "dist/host-sbom", { recursive: true });
    process.stdout.write(`Built signed Host package for ${version}. Notarization is required before publication.\n`);
  } catch (error) {
    await rm(destination, { force: true });
    throw error;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

await build();
