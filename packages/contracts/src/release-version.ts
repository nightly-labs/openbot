const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

const NUMERIC_IDENTIFIER = /^\d+$/u;

export interface ReleaseVersion {
  readonly parts: readonly number[];
  readonly prerelease: readonly string[];
}

export function isValidSemver(version: string): boolean {
  return SEMVER.test(version);
}

export function parseReleaseVersion(version: string): ReleaseVersion | null {
  const match = SEMVER.exec(version);
  if (!match) return null;
  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split(".") ?? [],
  };
}

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
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return left < right ? -1 : 1;
  }
  return version.length - other.length;
}

export function isNewerRelease(candidate: string, current: string): boolean {
  const next = parseReleaseVersion(candidate);
  const now = parseReleaseVersion(current);
  return next !== null && now !== null && compareReleaseVersions(next, now) > 0;
}
