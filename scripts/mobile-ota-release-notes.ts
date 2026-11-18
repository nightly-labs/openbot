// The release notes of an over-the-air (OTA) update of the mobile app. An OTA update changes only
// the JavaScript of a store build, so the store version in apps/mobile/app.json stays. The notes
// get their own section in apps/mobile/CHANGELOG.md, directly above the store version:
// `## [1.4.8.1] - 2026-11-12 (Android)` is the first OTA update of 1.4.8.
//
//   bun scripts/mobile-ota-release-notes.ts --base <git ref> --platform <ios|android|all>
//       [--head <git ref>] [--date YYYY-MM-DD] [--dry-run] [--allow-empty]
//
// `--base` is the commit or tag of the store build. The command moves the note files in
// apps/mobile/changelog.d that `--head` (default HEAD) has and `--base` does not have. The other
// files stay for the next store version: they can describe changes that need new native code.
// `--platform` names the platforms that get the update. `--dry-run` prints the section and
// changes nothing. With no note file the command stops; `--allow-empty` makes that a success.

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
  /** The commit or tag of the store build that gets the update. */
  base: string;
  head: string;
  /** The platforms that get the update. */
  stores: readonly MobileStore[];
  /** `YYYY-MM-DD`, the day of the update. */
  date: string;
}

export interface OtaNotesPlan {
  /** The store version that gets the update, such as "1.4.8". */
  storeVersion: string;
  /** The note files that move into the section. Empty when the update has no notes. */
  moved: string[];
  /** The note files that stay for the next store version. */
  kept: string[];
  /** The new section. Undefined when no file moves. */
  section?: { version: string; heading: string; body: string; changelog: string };
}

/** The note files in apps/mobile/changelog.d that `head` has and `base` does not have. */
function addedFragments(base: string, head: string): Set<string> {
  // The two trees, not the commits between them: this is also correct when `base` is on a release
  // branch that `head` does not contain. A renamed file is not a new note.
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

/** Reads the files and returns the new section. It writes nothing. */
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
  // Only the files that are still on disk, oldest first, as a store release orders them.
  const fragments = await releaseFragments(MOBILE_FRAGMENT_DIR);
  const moved = fragments.filter((path) => added.has(path));
  const kept = fragments.filter((path) => !added.has(path));
  if (moved.length === 0) return { storeVersion, moved, kept };

  const lines = readText(MOBILE_CHANGELOG).split("\n");
  const headings = lines.flatMap((line, index) => {
    const [, version = ""] = /^## \[([^\]]+)\]/.exec(line) ?? [];
    return version === "" ? [] : [{ version, index }];
  });
  // The newest section of this store version: the store version itself, or its last OTA update.
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
    // Only after the changelog holds their items.
    await Promise.all(plan.moved.map((path) => rm(path)));
    logger.info(
      `Wrote "${plan.section.heading}" in ${MOBILE_CHANGELOG} from ${plan.moved.length} note files.${keptLine} ` +
        `The store version stays ${plan.storeVersion}. Review, then commit ${MOBILE_CHANGELOG} and ${MOBILE_FRAGMENT_DIR}.`,
    );
  }
}
