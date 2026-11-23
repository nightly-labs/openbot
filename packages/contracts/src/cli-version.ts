export function isVersion(value: string): boolean {
  return /^\d+\.\d+\.\d+(?:(?:-\d{2}-\d{2}-\d{2})?-[0-9a-f]{7,40})?$/u.test(value);
}

export function olderVersion(installed: string, target: string): boolean {
  return isVersion(installed) && isVersion(target) && compareReleases(installed, target) < 0;
}

export function compareReleases(a: string, b: string): number {
  const release = (version: string) => version.replace(/-[0-9a-f]{7,40}$/u, "").replaceAll("-", ".");
  return release(a).localeCompare(release(b), "en", { numeric: true });
}
