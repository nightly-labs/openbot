import { readFile, writeFile } from "node:fs/promises";
import { isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import { MOBILE_ANNOUNCEMENT_FILE, mobileAnnouncementProblems } from "./discord-mobile-release-announcement";
import {
  formatStoreDates,
  MOBILE_CHANGELOG,
  MOBILE_STORE_NAMES,
  MOBILE_STORES,
  MOBILE_VERSION_FILES,
  parseStoreDates,
  releaseNotesProblems,
} from "./release-notes";

//   bun scripts/publish-mobile-release.ts <ios|android|both> [--version x.y.z]
//
// Run when a store makes the build available. It writes today's date for that store in the
// heading of the app.json version, or of `--version`, so the Mobile tab of /changelog shows the
// version and the stores that have it. Each store reviews a build on its own: run it one time for
// each store, in the order that they approve the build. When both stores have the version, the merge
// to main posts the highlights of apps/mobile/release-announcement.json on Discord, so the command
// stops while that file is not ready.

const logger = createOpenBotLogger("publish-mobile-release");
const USAGE = "Usage: bun run mobile:release:published <ios|android|both> [--version x.y.z]";

const args = process.argv.slice(2);
const versionFlag = args.indexOf("--version");
const requestedVersion = versionFlag === -1 ? undefined : args[versionFlag + 1];
const target = args.find((arg, index) => !arg.startsWith("--") && (versionFlag === -1 || index !== versionFlag + 1));
if (!isOneOf([...MOBILE_STORES, "both"] as const, target) || (versionFlag !== -1 && !isString(requestedVersion))) {
  throw new Error(USAGE);
}
const stores = target === "both" ? MOBILE_STORES : [target];

const appJson = JSON.parse(await readFile(MOBILE_VERSION_FILES[0], "utf8"));
const appVersion = isDynamicRecord(appJson) && isDynamicRecord(appJson.expo) ? appJson.expo.version : undefined;
const version = requestedVersion ?? appVersion;
if (!isString(version)) throw new Error(`${MOBILE_VERSION_FILES[0]} has no valid version.`);

const changelog = await readFile(MOBILE_CHANGELOG, "utf8");
const prefix = `## [${version}] - `;
const lines = changelog.split("\n");
const index = lines.findIndex((line) => line.startsWith(prefix));
if (index === -1) {
  throw new Error(`${MOBILE_CHANGELOG} has no "${prefix}" section. Run bun run mobile:release:patch first.`);
}
const heading = lines[index] ?? "";
const dates = parseStoreDates(heading.slice(prefix.length));
if (dates === undefined) throw new Error(`"${heading}" in ${MOBILE_CHANGELOG} is not a valid mobile heading.`);

const published = stores.filter((store) => dates[store] !== undefined);
if (published.length > 0) {
  const names = published.map((store) => MOBILE_STORE_NAMES[store]).join(" and ");
  throw new Error(`${version} is already available on ${names} ("${heading}"). Name only the other store.`);
}
const today = new Date().toISOString().slice(0, 10);
for (const store of stores) dates[store] = today;
lines[index] = `${prefix}${formatStoreDates(dates)}`;
const next = lines.join("\n");

const problems = releaseNotesProblems(next, version, { storeReview: true });
if (problems.length > 0) {
  throw new Error(
    [`The release notes for ${version} are not ready:`, ...problems.map((problem) => `- ${problem}`)].join("\n"),
  );
}
if (MOBILE_STORES.every((store) => dates[store] !== undefined)) {
  const announcement = await readFile(MOBILE_ANNOUNCEMENT_FILE, "utf8");
  const announcementProblems = mobileAnnouncementProblems(announcement, version);
  if (announcementProblems.length > 0) {
    throw new Error(
      [
        `Both stores will have ${version}, so its merge posts on Discord. Write the highlights in ${MOBILE_ANNOUNCEMENT_FILE} (apps/mobile/README.md#discord-announcement), then run this command again:`,
        ...announcementProblems.map((problem) => `- ${problem}`),
      ].join("\n"),
    );
  }
}
await writeFile(MOBILE_CHANGELOG, next);

const waiting = MOBILE_STORES.filter((store) => dates[store] === undefined).map((store) => MOBILE_STORE_NAMES[store]);
logger.info(
  [
    `The mobile app v${version} is available on ${stores.map((store) => MOBILE_STORE_NAMES[store]).join(" and ")}.`,
    waiting.length > 0
      ? `/changelog shows ${waiting.join(" and ")} as in review. Run this command again when that store makes the build available.`
      : `The merge to main posts the highlights of ${MOBILE_ANNOUNCEMENT_FILE} on Discord.`,
    `Commit ${MOBILE_CHANGELOG} and merge it to main.`,
  ]
    .filter(Boolean)
    .join(" "),
);
