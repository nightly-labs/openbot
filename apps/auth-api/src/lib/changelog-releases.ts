// The parsed release notes. Apart from `changelog.ts` because of the `?raw` imports: the header
// links to /changelog from every page and must not carry the whole files with it, and
// `vite.config.ts` loads `content-images.ts` in plain Node, so nothing that file reaches may
// import through Vite.

import changelogSource from "../../../../CHANGELOG.md?raw";
import mobileChangelogSource from "../../../mobile/CHANGELOG.md?raw";
import { type ChangelogPlatform, type ChangelogRelease, parseChangelog } from "./changelog";

export const CHANGELOG_RELEASES: Readonly<Record<ChangelogPlatform, readonly ChangelogRelease[]>> = {
  desktop: parseChangelog(changelogSource),
  mobile: parseChangelog(mobileChangelogSource, "mobile-"),
};

/** The date of the newest dated release, for the sitemap. */
export const CHANGELOG_UPDATED_AT = CHANGELOG_RELEASES.desktop.find((release) => release.date)?.date ?? "";
