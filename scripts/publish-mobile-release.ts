import { writeFile } from "node:fs/promises";
import { isOneOf, isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import { MOBILE_ANNOUNCEMENT_FILE } from "./discord-mobile-release-announcement";
import { appVersion, publishPlan } from "./mobile-release-steps";
import { MOBILE_STORE_NAMES, MOBILE_STORES } from "./release-notes";

//   bun scripts/publish-mobile-release.ts <ios|android|both> [--version x.y.z] [--skip-older]
//
// Run when a store makes the build available. It writes today's date for that store in the
// heading of the app.json version, or of `--version`, so the Mobile tab of /changelog shows the
// version and the stores that have it. It also raises that store's feature flags and newest version
// in apps/auth-api/src/server/mobile-features-config.ts. `--skip-older` marks the older versions that
// the store still reviews as skipped. After the merge and the Worker deploy, Discord gets a post for
// the store, so the command stops while apps/mobile/release-announcement.json is not ready.
// `bun run mobile:release` does the same from a menu, and opens the pull request.

const logger = createOpenBotLogger("publish-mobile-release");
const USAGE = "Usage: bun run mobile:release:published <ios|android|both> [--version x.y.z] [--skip-older]";

const args = process.argv.slice(2);
const versionFlag = args.indexOf("--version");
const requestedVersion = versionFlag === -1 ? undefined : args[versionFlag + 1];
const target = args.find((arg, index) => !arg.startsWith("--") && (versionFlag === -1 || index !== versionFlag + 1));
if (!isOneOf([...MOBILE_STORES, "both"] as const, target) || (versionFlag !== -1 && !isString(requestedVersion))) {
  throw new Error(USAGE);
}
const stores = target === "both" ? MOBILE_STORES : [target];
const version = requestedVersion ?? appVersion();

const plan = publishPlan(version, stores, args.includes("--skip-older"));
if (plan.announcementProblems.length > 0) {
  throw new Error(
    [
      `After the merge, Discord gets a post for ${version}. Write the highlights in ${MOBILE_ANNOUNCEMENT_FILE} (apps/mobile/README.md#discord-announcement), then run this command again:`,
      ...plan.announcementProblems.map((problem) => `- ${problem}`),
    ].join("\n"),
  );
}
await Promise.all(plan.changes.map((change) => writeFile(change.path, change.text)));

logger.info(
  [
    `The mobile app v${version} is available on ${stores.map((store) => MOBILE_STORE_NAMES[store]).join(" and ")}.`,
    ...plan.changes.map((change) => `${change.path}: ${change.summary}.`),
    "Commit the files and merge them to main. After the Worker deploy, Discord gets the post.",
  ].join(" "),
);
