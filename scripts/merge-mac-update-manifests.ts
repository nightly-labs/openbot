import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";

// `.loose()` keeps every key electron-builder wrote, including ones this script does not read.
const manifestSchema = z
  .object({
    version: z.string().min(1),
    files: z.array(z.object({ url: z.string().min(1) }).loose()).min(1),
    path: z.string().min(1),
  })
  .loose();
type UpdateManifest = z.infer<typeof manifestSchema>;

/**
 * Joins the `latest-mac.yml` of the ARM64 and the x64 build into the one manifest a release can
 * publish under that name.
 *
 * Each macOS job writes its own manifest, and a release holds one asset per name, so without this the
 * job that uploads last decides which Macs get updates. electron-updater reads the `files` list and
 * chooses by name: an Apple silicon Mac takes the files whose URL contains `arm64`, and an Intel Mac
 * takes the others. A file on the wrong side of that test leaves one architecture with no update, so
 * both lists are checked here, where the release can still stop.
 *
 * Every other key comes from the ARM64 manifest. Its `path` and `sha512` are what every release
 * before this one published, and an updater that reads only those keeps getting the ARM64 ZIP.
 */
export function mergeMacUpdateManifests(arm64Source: string, x64Source: string): string {
  const arm64 = parseManifest(arm64Source, "ARM64");
  const x64 = parseManifest(x64Source, "x64");
  if (arm64.version !== x64.version) {
    throw new Error(`The macOS manifests name different versions: ${arm64.version} and ${x64.version}.`);
  }
  for (const { url } of arm64.files) {
    if (!url.includes("arm64")) throw new Error(`The ARM64 manifest lists ${url}, which Apple silicon Macs skip.`);
  }
  for (const { url } of x64.files) {
    if (url.includes("arm64")) throw new Error(`The x64 manifest lists ${url}, which Intel Macs skip.`);
  }
  if (!arm64.files.some(({ url }) => url === arm64.path)) {
    throw new Error("The ARM64 manifest path is not one of its files.");
  }
  // `version: "1.1"` quotes `releaseDate`. electron-updater reads the manifest with js-yaml, which
  // turns an unquoted timestamp into a Date.
  return stringify({ ...arm64, files: [...arm64.files, ...x64.files] }, { version: "1.1" });
}

function parseManifest(source: string, label: string): UpdateManifest {
  const result = manifestSchema.safeParse(parse(source));
  if (!result.success) throw new Error(`The ${label} manifest is not valid: ${z.prettifyError(result.error)}`);
  return result.data;
}

if (import.meta.main) {
  const [arm64Path, x64Path, outputPath] = process.argv.slice(2);
  if (!arm64Path || !x64Path || !outputPath) {
    throw new Error("Usage: bun scripts/merge-mac-update-manifests.ts <arm64.yml> <x64.yml> <output.yml>");
  }
  const [arm64, x64] = await Promise.all([readFile(resolve(arm64Path), "utf8"), readFile(resolve(x64Path), "utf8")]);
  await writeFile(resolve(outputPath), mergeMacUpdateManifests(arm64, x64));
}
