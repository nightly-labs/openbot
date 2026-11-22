import changelogSource from "../../../../CHANGELOG.md?raw";
import mobileChangelogSource from "../../../mobile/CHANGELOG.md?raw";
import { type ChangelogPlatform, type ChangelogRelease, parseChangelog } from "./changelog";

export const CHANGELOG_RELEASES: Readonly<Record<ChangelogPlatform, readonly ChangelogRelease[]>> = {
  desktop: parseChangelog(changelogSource),
  mobile: parseChangelog(mobileChangelogSource, { anchorPrefix: "mobile-", stores: true }),
};

export const CHANGELOG_UPDATED_AT = CHANGELOG_RELEASES.desktop.find((release) => release.date)?.date ?? "";
