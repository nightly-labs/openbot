// The Discord post of a desktop release. The release preparation writes the highlights in
// `.github/release-announcement.json`, and `release.yml` posts them after the GitHub Release exists.
// The mobile app has its own post: `discord-mobile-release-announcement.ts`.
//
//   bun scripts/discord-release-announcement.ts check <version>  checks the file and prints the message
//   bun scripts/discord-release-announcement.ts send <version>   also posts it to DISCORD_RELEASE_WEBHOOK_URL
//
// The post mentions the role in DISCORD_RELEASE_ROLE_ID. `send` stops when it is not set.
//
// No package imports: `release.yml` runs this before `bun install`.

import { readFileSync } from "node:fs";
import {
  announcementFileProblems,
  LONGEST_ROLE_ID,
  postAnnouncement,
  releaseAnchor,
  roleIdProblems,
} from "./discord-announcement";

export const ANNOUNCEMENT_FILE = ".github/release-announcement.json";
const DOCS = "docs/RELEASING.md#discord-announcement";
/** The ID of the "Release Pings" role. A GitHub repository variable. */
export const ROLE_VARIABLE = "DISCORD_RELEASE_ROLE_ID";

/** What stops `announcement` from being posted for `version`. Empty when it is ready. */
export function announcementProblems(announcement: string, version: string): string[] {
  return announcementFileProblems(announcement, version, ANNOUNCEMENT_FILE, (highlights) =>
    announcementMessage(highlights, version, LONGEST_ROLE_ID),
  );
}

function changelogUrl(version: string): string {
  return `https://openbot.run/changelog#${releaseAnchor(version)}`;
}

/** Without `roleId`, the message names the role in plain text, so that `check` shows the post. */
function announcementMessage(highlights: readonly unknown[], version: string, roleId?: string): string {
  return [
    roleId === undefined ? "@Release Pings" : `<@&${roleId}>`,
    `**OpenBot v${version} is out**`,
    "",
    ...highlights.map((highlight) => `- ${String(highlight).trim()}`),
    "",
    `Full changelog: ${changelogUrl(version)}`,
  ].join("\n");
}

if (import.meta.main) {
  const [command, version] = process.argv.slice(2);
  if ((command !== "check" && command !== "send") || version === undefined) {
    process.stderr.write("Usage: bun scripts/discord-release-announcement.ts <check|send> <version>\n");
    process.exit(1);
  }
  const announcement = readFileSync(ANNOUNCEMENT_FILE, "utf8");
  const problems = announcementProblems(announcement, version);
  const roleId = process.env[ROLE_VARIABLE] || undefined;
  problems.push(...roleIdProblems(ROLE_VARIABLE, roleId, command === "send"));
  if (problems.length > 0) {
    process.stderr.write(
      [
        `The Discord announcement for OpenBot ${version} is not ready:`,
        ...problems.map((problem) => `- ${problem}`),
        "",
        `See ${DOCS}.`,
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
  const content = announcementMessage(JSON.parse(announcement).highlights, version, roleId);
  process.stdout.write(`${content}\n`);

  if (command === "send" && roleId !== undefined) {
    // Only this role is notified, even when a highlight or a changelog text names another one.
    const failure = await postAnnouncement(
      content,
      { parse: [], roles: [roleId] },
      "DISCORD_RELEASE_WEBHOOK_URL",
      DOCS,
    );
    if (failure !== undefined) {
      process.stderr.write(`${failure}\n`);
      process.exit(1);
    }
    process.stdout.write("Posted the announcement to Discord.\n");
  }
}
