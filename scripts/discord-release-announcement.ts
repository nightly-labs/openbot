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
export const ROLE_VARIABLE = "DISCORD_RELEASE_ROLE_ID";

export function announcementProblems(announcement: string, version: string): string[] {
  return announcementFileProblems(announcement, version, ANNOUNCEMENT_FILE, (highlights) =>
    announcementMessage(highlights, version, LONGEST_ROLE_ID),
  );
}

function changelogUrl(version: string): string {
  return `https://openbot.run/changelog#${releaseAnchor(version)}`;
}

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
