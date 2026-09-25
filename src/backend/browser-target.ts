import type { BrowserTarget } from "@openbot/contracts/ipc";

/**
 * Names a target in text the agent reads, such as `No element matches role button named “Save”.`,
 * and in the host diagnostics.
 */
export function describeBrowserTarget(target: BrowserTarget): string {
  switch (target.kind) {
    case "ref":
      return `ref ${target.ref}@${target.revision}`;
    case "role":
      return `role ${target.role}${target.name ? ` named “${target.name}”` : ""}`;
    case "text":
      return `text “${target.text}”`;
    case "css":
      return `css ${target.selector}`;
    case "point":
      return `point ${target.x},${target.y}`;
  }
}
