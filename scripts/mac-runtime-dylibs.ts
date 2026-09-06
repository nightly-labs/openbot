// What a Mach-O binary loads at runtime, and how to make those loads survive leaving the machine
// that linked them.
//
// Sunshine links Homebrew's miniupnpc and OpenSSL. Their `/opt/homebrew` paths exist on the build
// runner and on a developer's Mac, and nowhere else -- an installed app on a Mac without those
// formulae fails to start its streamer with a dyld error no OpenBot surface ever shows, so the
// member's session sits at "connecting" forever. Nothing in the build or the checks noticed,
// because presence and checksums say the file is the approved one; only its load commands say
// whether it can run.

import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

// The prefixes every macOS install carries, and so the only absolute load paths allowed to survive
// into a shipped binary.
const SYSTEM_LIBRARY_PREFIXES = ["/usr/lib/", "/System/"];

/** True for a load path that resolves on any Mac, or relative to whoever loads it. */
export function isPortableLoadPath(path: string): boolean {
  return path.startsWith("@") || SYSTEM_LIBRARY_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** The dynamic libraries a Mach-O file loads, without its own install name. */
export function readMachOLoadPaths(binary: string): string[] {
  const installName = readMachOInstallName(binary);
  return (
    execFileSync("otool", ["-L", binary], { encoding: "utf8" })
      .split("\n")
      // The first line is the file's own path, and a library repeats its install name before its
      // dependencies. Neither is something it loads.
      .slice(1)
      .map((line) => line.trim().split(" ")[0] ?? "")
      .filter((path) => path.length > 0 && path !== installName)
  );
}

function readMachOInstallName(binary: string): string | null {
  // `otool -D` prints the path header and then the install name, or nothing more for an executable.
  return execFileSync("otool", ["-D", binary], { encoding: "utf8" }).split("\n")[1]?.trim() || null;
}

/**
 * Copies every non-system library `executable` reaches into `frameworks` and re-points each load
 * command at the copy, transitively. Idempotent: a run over an already-bundled tree finds only
 * portable load paths and changes nothing.
 */
export function bundleMacDynamicLibraries(executable: string, frameworks: string): string[] {
  const fromExecutable = `@executable_path/${relative(dirname(executable), frameworks)}`;
  const bundled = new Set<string>();
  const pending = [executable];
  while (pending.length > 0) {
    const target = pending.pop();
    if (!target) break;
    for (const load of readMachOLoadPaths(target)) {
      if (isPortableLoadPath(load)) continue;
      const name = basename(load);
      const destination = join(frameworks, name);
      if (!bundled.has(name)) {
        bundled.add(name);
        // Created here rather than up front: a binary that needs nothing must not leave an empty
        // directory in the shipped tree.
        mkdirSync(frameworks, { recursive: true });
        copyFileSync(realpathSync(load), destination);
        // Homebrew ships its libraries read-only, and `install_name_tool` rewrites in place.
        chmodSync(destination, 0o755);
        // A copy keeps the id it was installed under, which would send anything linking it straight
        // back to Homebrew. `@loader_path` is the directory of whoever loads it -- this one.
        execFileSync("install_name_tool", ["-id", `@loader_path/${name}`, destination]);
        pending.push(destination);
      }
      const replacement = target === executable ? `${fromExecutable}/${name}` : `@loader_path/${name}`;
      execFileSync("install_name_tool", ["-change", load, replacement, target]);
    }
  }
  return [...bundled].sort();
}
