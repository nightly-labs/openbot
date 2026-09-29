// The release gate for CHANGELOG.md. The public /changelog page reads the file as it is, so a
// release that ships with an empty or malformed section ships with an empty or broken page entry.
// No package imports: `release.yml` runs this before `bun install`.

const RELEASE_GROUPS = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"];
const PLACEHOLDER = /\b(TODO|TBD|FIXME|XXX)\b/;

export const UNRELEASED = "Unreleased";

/** What stops `version` from being released. Empty when its section is ready. */
export function releaseNotesProblems(changelog: string, version: string): string[] {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start === -1) return [`CHANGELOG.md has no "## [${version}]" section.`];

  const problems: string[] = [];
  if (lines.filter((line) => line.startsWith(`## [${version}]`)).length > 1) {
    problems.push(`CHANGELOG.md has more than one "## [${version}]" section.`);
  }
  const heading = lines[start] ?? "";
  const date = /^## \[[^\]]+\] - (\d{4}-\d{2}-\d{2})$/.exec(heading)?.[1];
  // The page formats the date, and an impossible one such as 2026-13-45 stops it from rendering.
  if (version !== UNRELEASED && (date === undefined || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))) {
    problems.push(`"${heading}" must be "## [${version}] - YYYY-MM-DD" with a real date.`);
  }

  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  const section = lines.slice(start + 1, end === -1 ? undefined : end);
  let group: string | undefined;
  let groupEntries = 0;
  let entries = 0;
  const closeGroup = () => {
    if (group !== undefined && groupEntries === 0) problems.push(`"### ${group}" in ${version} has no entries.`);
  };

  for (const line of section) {
    const groupHeading = /^### (.+)$/.exec(line);
    if (groupHeading) {
      closeGroup();
      group = (groupHeading[1] ?? "").trim();
      groupEntries = 0;
      if (!RELEASE_GROUPS.includes(group)) {
        problems.push(`"### ${group}" in ${version} is not one of ${RELEASE_GROUPS.join(", ")}.`);
      }
      continue;
    }
    if (line.startsWith("- ")) {
      if (group === undefined) problems.push(`"${line}" in ${version} is not under a "### " group.`);
      if (line.slice(2).trim() === "") problems.push(`An item in ${version} has no text.`);
      groupEntries += 1;
      entries += 1;
    }
    if (PLACEHOLDER.test(line)) problems.push(`"${line.trim()}" in ${version} is a placeholder.`);
  }
  closeGroup();

  if (entries === 0) {
    problems.push(`${version} has no entries. Add "- " items under "### Added", "### Changed" or "### Fixed".`);
  }
  return problems;
}

/** Where each pull request writes its own notes. The release moves them into CHANGELOG.md. */
export const FRAGMENT_DIR = "changelog.d";

/** The iPhone app has its own notes and versions. `/changelog` shows them in its Mobile tab. */
export const MOBILE_CHANGELOG = "apps/mobile/CHANGELOG.md";
export const MOBILE_FRAGMENT_DIR = "apps/mobile/changelog.d";
/** `app.json` is the version that the App Store shows. The first file is where it is read. */
export const MOBILE_VERSION_FILES = ["apps/mobile/app.json", "apps/mobile/package.json"] as const;

/** The items under `## [Unreleased]`. A release moves them into its section. */
export function unreleasedItems(changelog: string): string[] {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## [${UNRELEASED}]`));
  if (start === -1) return [];
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines.slice(start + 1, end === -1 ? undefined : end).filter((line) => line.startsWith("- "));
}

/** What stops one fragment in `changelog.d` from being released. Empty when it is ready. */
export function fragmentProblems(fragment: string): string[] {
  const problems = releaseNotesProblems(`## [${UNRELEASED}]\n${fragment}`, UNRELEASED);
  if (/^##? /m.test(fragment)) problems.push(`Use only "### " group headings in a fragment.`);
  for (const line of collectGroups(fragment, new Map())) problems.push(`"${line.trim()}" is not in a "- " item.`);
  return problems;
}

/**
 * The section body that holds every item of `bodies`. The groups follow the order of
 * `RELEASE_GROUPS`, and the items in a group keep the order of `bodies`.
 */
export function assembleSection(bodies: readonly string[]): string {
  const groups = new Map<string, string[]>();
  // The release deletes the fragments after it writes this section, so a line that would be left
  // out stops the release instead.
  const stray = bodies.flatMap((body) => collectGroups(body, groups));
  if (stray.length > 0) {
    throw new Error(`These release notes lines are not in a "- " item:\n${stray.join("\n")}`);
  }
  const rank = (group: string) => {
    const index = RELEASE_GROUPS.indexOf(group);
    return index === -1 ? RELEASE_GROUPS.length : index;
  };
  return [...groups]
    .filter(([, items]) => items.length > 0)
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([group, items]) => `### ${group}\n\n${items.join("\n")}`)
    .join("\n\n");
}

/** Adds the items of `body` to `groups`, with their continuation lines. Returns the other lines. */
function collectGroups(body: string, groups: Map<string, string[]>): string[] {
  const stray: string[] = [];
  let items: string[] | undefined;
  let open = false;
  for (const line of body.split(/\r?\n/)) {
    const groupHeading = /^### (.+)$/.exec(line);
    if (groupHeading) {
      const group = (groupHeading[1] ?? "").trim();
      items = groups.get(group) ?? [];
      groups.set(group, items);
      open = false;
    } else if (line.trim() === "") {
      open = false;
    } else if (items && line.startsWith("- ")) {
      items.push(line);
      open = true;
    } else if (items && open) {
      items[items.length - 1] += `\n${line}`;
    } else {
      stray.push(line);
    }
  }
  return stray;
}
