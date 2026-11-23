import { rm, writeFile } from "node:fs/promises";
import { isOneOf, isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import { appJsonVersion, appVersion, readText, run, today } from "./mobile-release-steps";
import {
  assembleSection,
  formatStoreDates,
  MOBILE_CHANGELOG,
  MOBILE_FRAGMENT_DIR,
  MOBILE_STORES,
  MOBILE_VERSION_FILES,
  type MobileStore,
  otaSectionProblems,
  otaVersion,
  releaseFragments,
  type StoreDates,
} from "./release-notes";

const USAGE =
  "Usage: bun run mobile:release:ota --base <git ref> --platform <ios|android|all> [--head <git ref>] [--date YYYY-MM-DD] [--dry-run] [--allow-empty]";

export interface OtaNotesInput {
  base: string;
  head: string;
  stores: readonly MobileStore[];
  date: string;
}

export interface OtaNotesPlan {
  storeVersion: string;
  moved: string[];
  kept: string[];
  section?: { version: string; heading: string; body: string; changelog: string };
}

function addedFragments(base: string, head: string): Set<string> {
  const names = run("git", [
    "diff",
    "--no-renames",
    "--name-only",
    "-z",
    "--diff-filter=A",
    base,
    head,
    "--",
    MOBILE_FRAGMENT_DIR,
  ]);
  return new Set(names.split("\0").filter((name) => name !== ""));
}

export async function otaNotesPlan({ base, head, stores, date }: OtaNotesInput): Promise<OtaNotesPlan> {
  const storeVersion = appVersion();
  if (otaVersion(`${storeVersion}.1`) === undefined) {
    throw new Error(`${MOBILE_VERSION_FILES[0]} has the version ${storeVersion}, which is not x.y.z.`);
  }
  const baseVersion = appJsonVersion(
    run("git", ["show", `${base}:${MOBILE_VERSION_FILES[0]}`]),
    `${MOBILE_VERSION_FILES[0]} at ${base}`,
  );
  if (baseVersion !== storeVersion) {
    throw new Error(
      `${base} is the mobile version ${baseVersion}, but ${MOBILE_VERSION_FILES[0]} has ${storeVersion}. ` +
        `An OTA update reaches only the store build of the same version. Run the command on a branch that has the version ${baseVersion}.`,
    );
  }

  const added = addedFragments(base, head);
  const fragments = await releaseFragments(MOBILE_FRAGMENT_DIR);
  const moved = fragments.filter((path) => added.has(path));
  const kept = fragments.filter((path) => !added.has(path));
  if (moved.length === 0) return { storeVersion, moved, kept };

  const lines = readText(MOBILE_CHANGELOG).split("\n");
  const headings = lines.flatMap((line, index) => {
    const [, version = ""] = /^## \[([^\]]+)\]/.exec(line) ?? [];
    return version === "" ? [] : [{ version, index }];
  });
  const newest = headings.find(
    ({ version }) => version === storeVersion || otaVersion(version)?.store === storeVersion,
  );
  if (newest === undefined) {
    throw new Error(`${MOBILE_CHANGELOG} has no "## [${storeVersion}]" section. Prepare the store version first.`);
  }
  const version = `${storeVersion}.${(otaVersion(newest.version)?.number ?? 0) + 1}`;
  const dates: StoreDates = {};
  for (const store of stores) dates[store] = date;
  const heading = `## [${version}] - ${formatStoreDates(dates)}`;
  const body = assembleSection(moved.map((path) => readText(path)));
  const changelog = [...lines.slice(0, newest.index), heading, "", body, "", ...lines.slice(newest.index)].join("\n");

  const problems = otaSectionProblems(changelog);
  if (problems.length > 0) {
    throw new Error(
      [`The OTA release notes for ${version} are not ready:`, ...problems.map((problem) => `- ${problem}`)].join("\n"),
    );
  }
  return { storeVersion, moved, kept, section: { version, heading, body, changelog } };
}

if (import.meta.main) {
  const logger = createOpenBotLogger("mobile-ota-release-notes");
  const args = process.argv.slice(2);
  const option = (name: string) => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };
  const base = option("--base");
  const platform = option("--platform");
  if (!isString(base) || !isOneOf([...MOBILE_STORES, "all"] as const, platform)) throw new Error(USAGE);

  const plan = await otaNotesPlan({
    base,
    head: option("--head") ?? "HEAD",
    stores: platform === "all" ? MOBILE_STORES : [platform],
    date: option("--date") ?? today(),
  });
  const keptLine = plan.kept.length > 0 ? ` These files stay for the next store version: ${plan.kept.join(", ")}.` : "";

  if (plan.section === undefined) {
    const message = `No note file in ${MOBILE_FRAGMENT_DIR} is new since ${base}, so the OTA update of ${plan.storeVersion} has no release notes.${keptLine}`;
    if (!args.includes("--allow-empty")) {
      throw new Error(`${message} Write a note file and commit it, or use --allow-empty for an update with no notes.`);
    }
    logger.info(`${message} Nothing changed.`);
  } else if (args.includes("--dry-run")) {
    process.stdout.write(
      [
        `Dry run. ${MOBILE_CHANGELOG} would get this section from ${plan.moved.join(", ")}:`,
        "",
        plan.section.heading,
        "",
        plan.section.body,
        "",
        `These files would be deleted: ${plan.moved.join(", ")}.${keptLine}`,
        "",
      ].join("\n"),
    );
  } else {
    await writeFile(MOBILE_CHANGELOG, plan.section.changelog);
    await Promise.all(plan.moved.map((path) => rm(path)));
    logger.info(
      `Wrote "${plan.section.heading}" in ${MOBILE_CHANGELOG} from ${plan.moved.length} note files.${keptLine} ` +
        `The store version stays ${plan.storeVersion}. Review, then commit ${MOBILE_CHANGELOG} and ${MOBILE_FRAGMENT_DIR}.`,
    );
  }
}
