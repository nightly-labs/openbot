import { execFile } from "node:child_process";
import { lstat, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { HOST_MANAGER_DIRECTORY } from "../src/main/host-update-files";
import {
  HOST_EXECUTABLES,
  HOST_FILES,
  HOST_PACKAGE_ID,
  HOST_TEAM_ID,
  hostExecutableRequirement,
  hostFileMode,
  hostReleaseSchema,
} from "./host-installation";

const exec = promisify(execFile);
async function command(file: string, args: string[]): Promise<string> {
  const result = await exec(file, args, { maxBuffer: 8 * 1024 * 1024, timeout: 120_000 });
  return `${result.stdout}${result.stderr}`;
}

export function expectedHostPaths(): Set<string> {
  const paths = new Set<string>(["."]);
  for (const file of HOST_FILES) {
    paths.add(`.${file}`);
    for (let parent = dirname(file); parent !== "/"; parent = dirname(parent)) paths.add(`.${parent}`);
  }
  return paths;
}

export function verifyHostBom(text: string): void {
  const expected = expectedHostPaths();
  const seen = new Set<string>();
  for (const line of text.trim().split("\n")) {
    const [path, modeText, uid, gid] = line.split("\t");
    if (!expected.has(path) || seen.has(path) || uid !== "0" || gid !== "0" || !/^[0-7]+$/.test(modeText))
      throw new Error("Unexpected payload path, type or ownership.");
    const mode = Number.parseInt(modeText, 8);
    const isFile = HOST_FILES.some((file) => `.${file}` === path);
    if (
      (mode & 0o170000) !== (isFile ? 0o100000 : 0o040000) ||
      (mode & 0o7777) !== (isFile ? hostFileMode(path) : 0o755)
    )
      throw new Error("Unsafe payload mode or type.");
    seen.add(path);
  }
  if (seen.size !== expected.size) throw new Error("Missing host payload entries.");
}

export async function verifyHostPayload(expanded: string, version: string): Promise<void> {
  const info = await readFile(join(expanded, "PackageInfo"), "utf8");
  if (
    !info.includes(`identifier="${HOST_PACKAGE_ID}"`) ||
    !info.includes(`version="${version}"`) ||
    !info.includes('install-location="/"')
  )
    throw new Error("Host package version or destination mismatch.");
  verifyHostBom(await command("/usr/bin/lsbom", ["-p", "fmug", join(expanded, "Bom")]));
  const root = join(expanded, "Payload");
  const paths = expectedHostPaths();
  const visit = async (path: string, relative: string): Promise<void> => {
    if (!paths.has(relative)) throw new Error("Unexpected expanded payload entry.");
    const info = await lstat(path);
    if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()) || (info.isFile() && info.nlink !== 1))
      throw new Error("Unexpected payload link or special file.");
    if (info.isDirectory())
      for (const entry of await readdir(path)) await visit(join(path, entry), `${relative}/${entry}`);
  };
  await visit(root, ".");
  const release = hostReleaseSchema.parse(
    JSON.parse(await readFile(join(root, HOST_MANAGER_DIRECTORY, "host-release.json"), "utf8")),
  );
  if (release.version !== version) throw new Error("Host manifest version mismatch.");
  const scripts = (await readdir(join(expanded, "Scripts"))).sort();
  if (scripts.join(",") !== "postinstall,preinstall") throw new Error("Unexpected installer scripts.");
  for (const name of scripts) {
    if (
      (await readFile(join(expanded, "Scripts", name), "utf8")) !==
      (await readFile(`build/macos/host-updates/${name}`, "utf8"))
    )
      throw new Error("Installer script does not match release source.");
  }
  for (const [source, destination] of [
    ["openbot-host", "/usr/local/bin/openbot-host"],
    ["openbot-relaunch.sh", `${HOST_MANAGER_DIRECTORY}/openbot-relaunch.sh`],
    ["app.openbot.host-manager.plist", "/Library/LaunchDaemons/app.openbot.host-manager.plist"],
    ["app.openbot.desktop.relaunch.plist", "/Library/LaunchAgents/app.openbot.desktop.relaunch.plist"],
  ]) {
    if (
      (await readFile(join(root, destination), "utf8")) !==
      (await readFile(`build/macos/host-updates/${source}`, "utf8"))
    )
      throw new Error("Installed artifact does not match release source.");
    if (destination.endsWith(".plist")) await command("/usr/bin/plutil", ["-lint", join(root, destination)]);
  }
}

export async function verifyHostInstaller(pkg: string, version: string, requireNotarization = true): Promise<void> {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid release version.");
  const signature = await command("/usr/sbin/pkgutil", ["--check-signature", pkg]);
  if (
    !new RegExp(`^\\s*1[.:] Developer ID Installer:.*\\(${HOST_TEAM_ID}\\)\\s*$`, "m").test(signature) ||
    !signature.includes("signed by a certificate trusted by")
  )
    throw new Error("Unexpected installer signing identity.");
  if (requireNotarization) {
    await command("/usr/sbin/spctl", ["--assess", "--type", "install", "--verbose=2", pkg]);
    await command("/usr/bin/xcrun", ["stapler", "validate", pkg]);
  }
  const temp = await mkdtemp(join(tmpdir(), "openbot-host-package-"));
  const expanded = join(temp, "expanded");
  try {
    await command("/usr/sbin/pkgutil", ["--expand-full", resolve(pkg), expanded]);
    await verifyHostPayload(expanded, version);
    for (const name of HOST_EXECUTABLES) {
      const binary = join(expanded, "Payload", HOST_MANAGER_DIRECTORY, name);
      const arch = await command("/usr/bin/file", [binary]);
      if (!arch.includes("Mach-O 64-bit executable arm64")) throw new Error("Host executable is not ARM64 Mach-O.");
      await command("/usr/bin/codesign", [
        "--verify",
        "--strict",
        "--verbose=2",
        "-R",
        hostExecutableRequirement(name),
        binary,
      ]);
      const details = await command("/usr/bin/codesign", ["-d", "--verbose=4", binary]);
      if (!/^CodeDirectory .*flags=.*\bruntime\b/m.test(details) || !details.includes(`TeamIdentifier=${HOST_TEAM_ID}`))
        throw new Error("Host executable lacks hardened runtime or team identity.");
      const libraries = await command("/usr/bin/otool", ["-L", binary]);
      for (const line of libraries
        .split("\n")
        .slice(1)
        .filter((line) => line.trim())) {
        if (!/^\s*\/(usr\/lib|System\/Library)\//.test(line)) throw new Error("Non-system runtime dependency.");
      }
      await exec(binary, [name === "host-manager" ? "--runtime-check" : "--help"], {
        env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: "/var/empty" },
        timeout: 30_000,
      });
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const [pkg, version] = process.argv.slice(2);
  if (!pkg || !version) throw new Error("Usage: bun scripts/verify-host-installer.ts <pkg> <version>");
  await verifyHostInstaller(pkg, version);
  process.stdout.write("Host package signature, notarization, payload and standalone executables verified.\n");
}
