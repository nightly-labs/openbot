import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { APP_SURFACES, type AppSurface } from "@openbot/contracts/app-minimum-version";
import { createOpenBotLogger } from "@openbot/logging";
import { type ChangelogPlatform, type ChangelogRelease, parseChangelog } from "../apps/auth-api/src/lib/changelog";
import { APP_MINIMUM_VERSIONS } from "../apps/auth-api/src/server/app-minimum-version";

const SUPPORT_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const OTA_VERSION = /^\d+\.\d+\.\d+\.\d+$/;

export function appMinimumVersionProblems(
  versions: Readonly<Record<AppSurface, string | null>>,
  releases: Readonly<Record<ChangelogPlatform, readonly ChangelogRelease[]>>,
  today: string,
): string[] {
  const latestDate = new Date(Date.parse(`${today}T00:00:00Z`) - SUPPORT_DAYS * DAY_MS).toISOString().slice(0, 10);
  const problems: string[] = [];
  for (const surface of APP_SURFACES) {
    const version = versions[surface];
    if (version === null) continue;
    const mobile = surface === "ios" || surface === "android";
    const release = releases[mobile ? "mobile" : "desktop"].find((entry) => entry.version === version);
    let date = release?.date ?? "";
    if (mobile)
      date = OTA_VERSION.test(version) ? "" : (release?.stores.find((store) => store.store === surface)?.date ?? "");
    if (!date) problems.push(`${surface}: ${version} is not a released ${mobile ? "store " : ""}version.`);
    else if (date > latestDate)
      problems.push(
        `${surface}: ${version} was released on ${date}; the minimum must be released on ${latestDate} or before.`,
      );
  }
  return problems;
}

if (import.meta.main) {
  const root = resolve(import.meta.dirname, "..");
  const read = (path: string) => readFileSync(resolve(root, path), "utf8");
  const releases = {
    desktop: parseChangelog(read("CHANGELOG.md")),
    mobile: parseChangelog(read("apps/mobile/CHANGELOG.md"), { stores: true }),
  };
  const logger = createOpenBotLogger("check-app-minimum-version");
  const problems = appMinimumVersionProblems(APP_MINIMUM_VERSIONS, releases, new Date().toISOString().slice(0, 10));
  for (const problem of problems) logger.error(problem);
  if (problems.length > 0) process.exit(1);
  logger.info(`Minimum app versions are allowed: ${JSON.stringify(APP_MINIMUM_VERSIONS)}`);
}
