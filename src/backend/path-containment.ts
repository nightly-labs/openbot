import { isAbsolute, relative, sep } from "node:path";

/**
 * Whether `target` is `root` or a path below it. Only the path text is compared: resolve symbolic
 * links with `realpath` first when the target can contain one.
 */
export function isPathInside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}
