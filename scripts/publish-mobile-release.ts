import { readFile, writeFile } from "node:fs/promises";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import { IN_REVIEW, MOBILE_CHANGELOG, MOBILE_VERSION_FILES, releaseNotesProblems } from "./release-notes";

//   bun scripts/publish-mobile-release.ts
//
// Run when the store makes the build of the app.json version available. It replaces
// "In review" with today's date, so the Mobile tab of /changelog shows the version.

const logger = createOpenBotLogger("publish-mobile-release");

const appJson = JSON.parse(await readFile(MOBILE_VERSION_FILES[0], "utf8"));
const version = isDynamicRecord(appJson) && isDynamicRecord(appJson.expo) ? appJson.expo.version : undefined;
if (!isString(version)) throw new Error(`${MOBILE_VERSION_FILES[0]} has no valid version.`);

const changelog = await readFile(MOBILE_CHANGELOG, "utf8");
const inReview = `## [${version}] - ${IN_REVIEW}`;
const lines = changelog.split("\n");
const index = lines.indexOf(inReview);
if (index === -1) {
  throw new Error(`${MOBILE_CHANGELOG} has no "${inReview}" section. Run bun run mobile:release:patch first.`);
}
lines[index] = `## [${version}] - ${new Date().toISOString().slice(0, 10)}`;
const published = lines.join("\n");

const problems = releaseNotesProblems(published, version);
if (problems.length > 0) {
  throw new Error(
    [`The release notes for ${version} are not ready:`, ...problems.map((problem) => `- ${problem}`)].join("\n"),
  );
}
await writeFile(MOBILE_CHANGELOG, published);

logger.info(`Published the mobile app v${version}. Commit ${MOBILE_CHANGELOG} and merge it to main.`);
