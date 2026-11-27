import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createOpenBotLogger } from "@openbot/logging";
import { parse } from "yaml";
import { z } from "zod";
import { readScriptArguments } from "./script-arguments";

const USAGE = `Usage:
  bun scripts/update-rollout.ts --version <x.y.z> --percentage <0-100> <manifest>...
  bun scripts/update-rollout.ts --check --version <x.y.z> --percentage <0-100> <manifest>...

Give the four manifests of one release: latest.yml, latest-mac.yml, latest-linux.yml and
latest-linux-arm64.yml.
0 pauses the rollout. 100 removes the field, so the release goes to every install.
--check changes nothing. It stops when a manifest does not have the percentage.`;

export const UPDATE_MANIFESTS = ["latest.yml", "latest-mac.yml", "latest-linux.yml", "latest-linux-arm64.yml"] as const;

const STAGING_LINE = /^stagingPercentage\s*:/u;

export function parseStagingPercentage(value: string): number {
  if (!/^(?:0|[1-9]\d?|100)$/u.test(value)) {
    throw new Error(`The rollout percentage must be a whole number from 0 to 100, not "${value}".`);
  }
  return Number(value);
}

const updateManifestSchema = z
  .object({
    version: z.string().min(1),
    path: z.string().min(1).optional(),
    sha512: z.string().min(1).optional(),
    files: z
      .array(
        z
          .object({
            url: z.string().min(1),
            sha512: z.string().min(1),
            size: z.number().int().nonnegative(),
            blockMapSize: z.number().int().nonnegative().optional(),
          })
          .loose(),
      )
      .min(1),
    stagingPercentage: z.number().int().min(0).max(100).optional(),
  })
  .loose();
export type UpdateManifest = z.infer<typeof updateManifestSchema>;

export function readUpdateManifest(source: string, version: "1.1" | "1.2" = "1.2"): UpdateManifest {
  const result = updateManifestSchema.safeParse(parse(source, { version }));
  if (!result.success) throw new Error(`The update manifest is not valid: ${z.prettifyError(result.error)}`);
  return result.data;
}

export function readStagingPercentage(manifest: UpdateManifest): number {
  return manifest.stagingPercentage ?? 100;
}

export function setStagingPercentage(source: string, percentage: number): string {
  if (!Number.isInteger(percentage) || percentage < 0 || percentage > 100) {
    throw new Error("The rollout percentage must be a whole number from 0 to 100.");
  }
  const lines = otherLines(source);
  if (percentage < 100) lines.push(`stagingPercentage: ${percentage}`);
  const updated = `${lines.join("\n")}\n`;
  assertOnlyStagingChanged(source, updated, percentage);
  return updated;
}

export function assertOnlyStagingChanged(original: string, updated: string, percentage: number): void {
  if (!isDeepStrictEqual(otherLines(original), otherLines(updated))) {
    throw new Error("The update manifest has changes on lines other than stagingPercentage.");
  }
  for (const version of ["1.1", "1.2"] as const) {
    const { stagingPercentage: _before, ...before } = readUpdateManifest(original, version);
    const after = readUpdateManifest(updated, version);
    if (readStagingPercentage(after) !== percentage) {
      throw new Error(`The update manifest does not have the rollout percentage ${percentage}.`);
    }
    const { stagingPercentage: _after, ...rest } = after;
    if (!isDeepStrictEqual(before, rest)) {
      throw new Error("The update manifest has changes other than stagingPercentage.");
    }
  }
}

function otherLines(text: string): string[] {
  return text
    .replace(/\n$/u, "")
    .split("\n")
    .filter((line) => !STAGING_LINE.test(line));
}

function assertReleaseManifests(paths: readonly string[]): void {
  const names = paths.map((path) => basename(path)).sort();
  if (!isDeepStrictEqual(names, [...UPDATE_MANIFESTS].sort())) {
    throw new Error(`Give each of ${UPDATE_MANIFESTS.join(", ")} once. Got: ${names.join(", ") || "none"}.`);
  }
}

if (import.meta.main) {
  const logger = createOpenBotLogger("update-rollout");
  const parsed = readScriptArguments({
    usage: USAGE,
    options: {
      version: { type: "string" },
      percentage: { type: "string" },
      check: { type: "boolean" },
    },
    maxPositionals: UPDATE_MANIFESTS.length,
  });
  if (parsed) {
    const { values, positionals } = parsed;
    if (!values.version || !/^\d+\.\d+\.\d+$/u.test(values.version) || values.percentage === undefined) {
      process.stderr.write(`${USAGE}\n`);
      process.exit(2);
    }
    const percentage = parseStagingPercentage(values.percentage);
    assertReleaseManifests(positionals);
    const changes = await Promise.all(
      positionals.map(async (candidate) => {
        const path = resolve(candidate);
        const original = await readFile(path, "utf8");
        const manifest = readUpdateManifest(original);
        if (manifest.version !== values.version) {
          throw new Error(`${basename(path)} names version ${manifest.version}, not ${values.version}.`);
        }
        const current = readStagingPercentage(manifest);
        if (values.check && current !== percentage) {
          throw new Error(`${basename(path)} has ${current}%, not ${percentage}%.`);
        }
        return {
          path,
          original,
          current,
          updated: values.check ? original : setStagingPercentage(original, percentage),
        };
      }),
    );
    for (const { path, original, current, updated } of changes) {
      if (values.check) {
        logger.info(`${basename(path)}: ${values.version} at ${current}%.`);
        continue;
      }
      await writeFile(path, updated);
      assertOnlyStagingChanged(original, await readFile(path, "utf8"), percentage);
      logger.info(`${basename(path)}: ${values.version} from ${current}% to ${percentage}%.`);
    }
  }
}
