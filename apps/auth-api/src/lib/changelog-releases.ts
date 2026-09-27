// The parsed release notes. Apart from `changelog.ts` because of the `?raw` import: the header
// links to /changelog from every page and must not carry the whole file with it, and
// `vite.config.ts` loads `content-images.ts` in plain Node, so nothing that file reaches may
// import through Vite.

import changelogSource from "../../../../CHANGELOG.md?raw";
import { parseChangelog } from "./changelog";

export const CHANGELOG_RELEASES = parseChangelog(changelogSource);

/** The date of the newest dated release, for the sitemap. */
export const CHANGELOG_UPDATED_AT = CHANGELOG_RELEASES.find((release) => release.date)?.date ?? "";
