// The Discord post of a mobile release. Android and iOS review a build on their own, often days
// apart, so there is one post per version, when the second store has it. The source is
// apps/mobile/CHANGELOG.md, not the stores: `bun run mobile:release:published` writes each store's
// date there. `mobile-release-announcement.yml` posts the highlights of
// `apps/mobile/release-announcement.json` when a push to main gives a version its second store.
//
//   bun scripts/discord-mobile-release-announcement.ts available <old CHANGELOG.md>
//       prints the version that is on both stores now and was not in <old CHANGELOG.md>, or nothing
//   bun scripts/discord-mobile-release-announcement.ts check <version>  checks the file and prints the message
//   bun scripts/discord-mobile-release-announcement.ts send <version>   also posts it to DISCORD_MOBILE_RELEASE_WEBHOOK_URL
//
// No package imports: the workflow runs this before `bun install`.

import { readFileSync } from "node:fs";
import { ANDROID_PLAY_STORE_URL } from "../packages/ui/src/features/mobile-app/android-play-store";
import { IOS_APP_STORE_URL } from "../packages/ui/src/features/mobile-app/ios-app-store";
import {
  announcementFileProblems,
  LONGEST_ROLE_ID,
  postAnnouncement,
  releaseAnchor,
  roleIdProblems,
} from "./discord-announcement";
import { MOBILE_CHANGELOG, MOBILE_STORES, parseStoreDates } from "./release-notes";

export const MOBILE_ANNOUNCEMENT_FILE = "apps/mobile/release-announcement.json";
const DOCS = "apps/mobile/README.md#discord-announcement";
/** The ID of the "Mobile Release Pings" role. A GitHub variable of the `release-mobile` environment. */
const ROLE_VARIABLE = "DISCORD_MOBILE_RELEASE_ROLE_ID";

/** The versions of `changelog` that both stores have, newest first. */
export function versionsOnBothStores(changelog: string): string[] {
  return changelog.split(/\r?\n/).flatMap((line) => {
    const [, version = "", dates = ""] = /^## \[([^\]]+)\] - (.+)$/.exec(line) ?? [];
    const stores = parseStoreDates(dates);
    return stores !== undefined && MOBILE_STORES.every((store) => stores[store] !== undefined) ? [version] : [];
  });
}

/** What stops `announcement` from being posted for `version`. Empty when it is ready. */
export function mobileAnnouncementProblems(announcement: string, version: string): string[] {
  return announcementFileProblems(announcement, version, MOBILE_ANNOUNCEMENT_FILE, (highlights) =>
    announcementMessage(highlights, version, LONGEST_ROLE_ID),
  );
}

function changelogUrl(version: string): string {
  return `https://openbot.run/changelog?platform=mobile#mobile-${releaseAnchor(version)}`;
}

/** Without `roleId`, the message names the role in plain text, so that `check` shows the post. */
function announcementMessage(highlights: readonly unknown[], version: string, roleId?: string): string {
  return [
    roleId === undefined ? "@Mobile Release Pings" : `<@&${roleId}>`,
    `**OpenBot v${version} is out on iOS and Android**`,
    "",
    ...highlights.map((highlight) => `- ${String(highlight).trim()}`),
    "",
    // Masked links keep the footer on one line. The angle brackets stop Discord from adding a preview of each page.
    [
      `[iOS](<${IOS_APP_STORE_URL}>)`,
      `[Android](<${ANDROID_PLAY_STORE_URL}>)`,
      `[Full Changelog](<${changelogUrl(version)}>)`,
    ].join(" · "),
  ].join("\n");
}

function fail(lines: readonly string[]): never {
  process.stderr.write(`${lines.join("\n")}\n`);
  process.exit(1);
}

if (import.meta.main) {
  const [command, argument] = process.argv.slice(2);
  if ((command !== "available" && command !== "check" && command !== "send") || argument === undefined) {
    fail([
      "Usage: bun scripts/discord-mobile-release-announcement.ts <available <old CHANGELOG.md>|check|send <version>>",
    ]);
  }

  const changelog = readFileSync(MOBILE_CHANGELOG, "utf8");
  if (command === "available") {
    const before = new Set(versionsOnBothStores(readFileSync(argument, "utf8")));
    // The newest one only: the announcement file holds one version, and an older one is old news.
    const [version] = versionsOnBothStores(changelog).filter((candidate) => !before.has(candidate));
    if (version !== undefined) process.stdout.write(`${version}\n`);
    process.exit(0);
  }

  const version = argument;
  const problems = versionsOnBothStores(changelog).includes(version)
    ? []
    : [`${MOBILE_CHANGELOG} does not show ${version} on both stores. Run bun run mobile:release:published first.`];
  const announcement = readFileSync(MOBILE_ANNOUNCEMENT_FILE, "utf8");
  problems.push(...mobileAnnouncementProblems(announcement, version));
  const roleId = process.env[ROLE_VARIABLE] || undefined;
  problems.push(...roleIdProblems(ROLE_VARIABLE, roleId, command === "send"));
  if (problems.length > 0) {
    fail([
      `The Discord announcement for OpenBot mobile ${version} is not ready:`,
      ...problems.map((problem) => `- ${problem}`),
      "",
      `See ${DOCS}.`,
    ]);
  }
  const content = announcementMessage(JSON.parse(announcement).highlights, version, roleId);
  process.stdout.write(`${content}\n`);

  if (command === "send" && roleId !== undefined) {
    // Only this role is notified, even when a highlight or a changelog text names another one.
    const failure = await postAnnouncement(
      content,
      { parse: [], roles: [roleId] },
      "DISCORD_MOBILE_RELEASE_WEBHOOK_URL",
      DOCS,
    );
    if (failure !== undefined) fail([failure]);
    process.stdout.write("Posted the announcement to Discord.\n");
  }
}
