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
