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
import { chmodSync, copyFileSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

// The prefixes every macOS install carries, and so the only absolute load paths allowed to survive
// into a shipped binary.
const SYSTEM_LIBRARY_PREFIXES = ["/usr/lib/", "/System/"];

/**
 * Every non-system library allowed into the shipped runtime, and the licence its redistribution
 * requires. Bundling is what creates that obligation: until the runtime carried its own copies these
 * libraries stayed on the machine that linked them and OpenBot redistributed nothing. miniupnpc is
 * BSD-3-Clause and OpenSSL 3 is Apache-2.0, and both ask for the notice to travel with the binary.
 *
 * Keyed by the name before the version, because a Homebrew bump moves `libssl.3.dylib` to a new
 * number without changing the terms. An unlisted library fails the build: shipping one whose licence
 * nobody has read is the outcome this table exists to prevent, and silence is how it would happen.
 */
const REDISTRIBUTED_LIBRARIES: Readonly<Record<string, { readonly formula: string; readonly license: string }>> = {
  libminiupnpc: { formula: "miniupnpc", license: "miniupnpc-BSD-3-Clause.txt" },
  libssl: { formula: "openssl@3", license: "openssl-Apache-2.0.txt" },
  libcrypto: { formula: "openssl@3", license: "openssl-Apache-2.0.txt" },
};

// Homebrew writes one of these at the root of a formula's installed tree.
const LICENSE_FILE_NAMES = ["LICENSE", "LICENSE.txt", "COPYING", "COPYING.txt"];

/** A library copied into the runtime, and where it came from. */
export interface BundledLibrary {
  /** File name inside the runtime, such as `libssl.3.dylib`. */
  readonly name: string;
  /** Absolute path of the copy the runtime ships. */
  readonly path: string;
  /** The file it was copied from, resolved through symlinks. */
  readonly origin: string;
}

/** The licence file a bundled library must ship beside, or `null` when it is not one we may ship. */
export function bundledLibraryLicense(name: string): { readonly formula: string; readonly license: string } | null {
  return REDISTRIBUTED_LIBRARIES[name.split(".")[0] ?? ""] ?? null;
}

/**
 * The licence files a set of bundled libraries obliges the distribution to carry, deduplicated --
 * `libssl` and `libcrypto` are one formula and one notice. Throws on a library missing from
 * `REDISTRIBUTED_LIBRARIES`, or present there with no licence file on disk to copy.
 */
export function bundledLibraryLicenses(libraries: readonly BundledLibrary[]): { file: string; source: string }[] {
  const licenses = new Map<string, string>();
  for (const library of libraries) {
    const entry = bundledLibraryLicense(library.name);
    if (!entry) {
      throw new Error(
        `${library.name} would ship in the runtime with no licence recorded for it. Add it to REDISTRIBUTED_LIBRARIES with the terms its redistribution requires, or stop bundling it.`,
      );
    }
    if (!licenses.has(entry.license)) licenses.set(entry.license, findLicenseFile(library.origin, entry.formula));
  }
  return [...licenses].map(([file, source]) => ({ file, source })).sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Homebrew installs a formula's licence at the root of its versioned tree, one level above `lib`, so
 * this walks up from the library. Bounded, and the directory has to be inside the formula it claims:
 * a file found further up belongs to the prefix rather than the package, and shipping the wrong
 * notice is worse than failing the build.
 */
function findLicenseFile(origin: string, formula: string): string {
  let directory = dirname(origin);
  for (let depth = 0; depth < 3; depth += 1) {
    if (directory.includes(`/${formula}/`)) {
      for (const name of LICENSE_FILE_NAMES) {
        const candidate = join(directory, name);
        if (existsSync(candidate)) return candidate;
      }
    }
    const parent = resolve(directory, "..");
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`No licence file accompanies ${formula} at ${origin}, so its notice cannot ship with the runtime.`);
}

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
export function bundleMacDynamicLibraries(executable: string, frameworks: string): BundledLibrary[] {
  const fromExecutable = `@executable_path/${relative(dirname(executable), frameworks)}`;
  const bundled = new Map<string, BundledLibrary>();
  const pending = [executable];
  while (pending.length > 0) {
    const target = pending.pop();
    if (!target) break;
    for (const load of readMachOLoadPaths(target)) {
      if (isPortableLoadPath(load)) continue;
      const name = basename(load);
      const destination = join(frameworks, name);
      if (!bundled.has(name)) {
        const origin = realpathSync(load);
        bundled.set(name, { name, path: destination, origin });
        // Created here rather than up front: a binary that needs nothing must not leave an empty
        // directory in the shipped tree.
        mkdirSync(frameworks, { recursive: true });
        copyFileSync(origin, destination);
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
  return [...bundled.values()].sort((a, b) => a.name.localeCompare(b.name));
}
