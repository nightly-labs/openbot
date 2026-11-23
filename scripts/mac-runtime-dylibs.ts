import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

const SYSTEM_LIBRARY_PREFIXES = ["/usr/lib/", "/System/"];

const REDISTRIBUTED_LIBRARIES: Readonly<Record<string, { readonly formula: string; readonly license: string }>> = {
  libminiupnpc: { formula: "miniupnpc", license: "miniupnpc-BSD-3-Clause.txt" },
  libssl: { formula: "openssl@3", license: "openssl-Apache-2.0.txt" },
  libcrypto: { formula: "openssl@3", license: "openssl-Apache-2.0.txt" },
};

const LICENSE_FILE_NAMES = ["LICENSE", "LICENSE.txt", "COPYING", "COPYING.txt"];

export interface BundledLibrary {
  readonly name: string;
  readonly path: string;
  readonly origin: string;
}

export function bundledLibraryLicense(name: string): { readonly formula: string; readonly license: string } | null {
  return REDISTRIBUTED_LIBRARIES[name.split(".")[0] ?? ""] ?? null;
}

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

export function isPortableLoadPath(path: string): boolean {
  return path.startsWith("@") || SYSTEM_LIBRARY_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function readMachOLoadPaths(binary: string): string[] {
  const installName = readMachOInstallName(binary);
  return execFileSync("otool", ["-L", binary], { encoding: "utf8" })
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(" ")[0] ?? "")
    .filter((path) => path.length > 0 && path !== installName);
}

function readMachOInstallName(binary: string): string | null {
  return execFileSync("otool", ["-D", binary], { encoding: "utf8" }).split("\n")[1]?.trim() || null;
}

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
        mkdirSync(frameworks, { recursive: true });
        copyFileSync(origin, destination);
        chmodSync(destination, 0o755);
        execFileSync("install_name_tool", ["-id", `@loader_path/${name}`, destination]);
        pending.push(destination);
      }
      const replacement = target === executable ? `${fromExecutable}/${name}` : `@loader_path/${name}`;
      execFileSync("install_name_tool", ["-change", load, replacement, target]);
    }
  }
  return [...bundled.values()].sort((a, b) => a.name.localeCompare(b.name));
}
