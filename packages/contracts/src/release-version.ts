/**
 * The release versions of OpenBot: the versions that the update feeds, the installed build and the
 * host release check name. They are SemVer 2.0.0, without a leading "v".
 *
 * `scripts/release-version-cases.json` is the record of how versions compare. The bash `newer()` of
 * `scripts/hosting/openbot-hosted-update` must give the same results for the stable versions in it;
 * `scripts/release-version-comparator-e2e.ts` checks both.
 */

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

const NUMERIC_IDENTIFIER = /^\d+$/u;

export interface ReleaseVersion {
  /** The numeric parts. A part that is missing counts as 0, so "1.2" is equal to "1.2.0". */
  readonly parts: readonly number[];
  /** The pre-release identifiers, such as `["beta", "1"]` for "1.2.3-beta.1". Empty for a release. */
  readonly prerelease: readonly string[];
}

export function isValidSemver(version: string): boolean {
  return SEMVER.test(version);
}

/** The parts of a SemVer 2.0.0 version, or null. Build metadata ("+...") has no effect on the order. */
export function parseReleaseVersion(version: string): ReleaseVersion | null {
  const match = SEMVER.exec(version);
  if (!match) return null;
  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split(".") ?? [],
  };
}

/**
 * Negative when `version` comes before `other`, positive when it comes after, and 0 when they are
 * equal. The order is the SemVer 2.0.0 precedence: numeric parts first, then a release comes after
 * each of its pre-releases.
 */
export function compareReleaseVersions(version: ReleaseVersion, other: ReleaseVersion): number {
  for (let index = 0; index < Math.max(version.parts.length, other.parts.length); index += 1) {
    const difference = (version.parts[index] ?? 0) - (other.parts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return comparePrerelease(version.prerelease, other.prerelease);
}

function comparePrerelease(version: readonly string[], other: readonly string[]): number {
  if (version.length === 0 || other.length === 0) return other.length - version.length;
  for (let index = 0; index < Math.min(version.length, other.length); index += 1) {
    const left = version[index] ?? "";
    const right = other[index] ?? "";
    if (left === right) continue;
    const leftNumeric = NUMERIC_IDENTIFIER.test(left);
    const rightNumeric = NUMERIC_IDENTIFIER.test(right);
    if (leftNumeric && rightNumeric) return Number(left) - Number(right);
    // A numeric identifier comes before an alphanumeric one.
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return left < right ? -1 : 1;
  }
  return version.length - other.length;
}

/**
 * True when `candidate` comes after `current`. A version that is not SemVer is never newer, and no
 * version is newer than it: an update must not move to or from a version that it cannot read.
 */
export function isNewerRelease(candidate: string, current: string): boolean {
  const next = parseReleaseVersion(candidate);
  const now = parseReleaseVersion(current);
  return next !== null && now !== null && compareReleaseVersions(next, now) > 0;
}
