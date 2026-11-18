import { type FSWatcher, readFileSync, statSync, watch } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Plugin } from "vite";
import { developmentWorktreeColor } from "../src/main/development-profile";

/** The renderer asks with this event; `src/renderer/src/dev-worktree.ts` sends it. */
const REQUEST_EVENT = "openbot:dev-worktree-request";
/** The answer, and each later branch change. */
const WORKTREE_EVENT = "openbot:dev-worktree";

/**
 * Gives a dev renderer the branch and the color of its worktree, so the apps of two worktrees that
 * are open at the same time are easy to tell apart. The main process tints the Dock icon with the same
 * color. The data goes over the HMR connection, so a build, Storybook and Vitest have none of it.
 *
 * Git can give the branch a new name while the app runs, so the plugin watches `HEAD` and sends the
 * new name to each window. Vite does not watch `.git`, so the plugin has its own watcher.
 */
export function devWorktree(projectRoot: string): Plugin {
  return {
    name: "openbot-dev-worktree",
    apply: "serve",
    configureServer(server) {
      const gitDirectory = findGitDirectory(projectRoot);
      const color = developmentWorktreeColor(projectRoot);
      let branch = gitDirectory ? readBranch(gitDirectory) : null;
      const worktree = () => ({ branch, color });
      server.ws.on(REQUEST_EVENT, (_data, client) => client.send(WORKTREE_EVENT, worktree()));
      if (!gitDirectory) return;
      let watcher: FSWatcher;
      try {
        // Git writes `HEAD.lock` and renames it to `HEAD`, so the directory is watched, not the file.
        // Some file systems give no file name; the branch is read again then.
        watcher = watch(gitDirectory, (_event, fileName) => {
          if (fileName && fileName !== "HEAD") return;
          const next = readBranch(gitDirectory);
          if (next === branch) return;
          branch = next;
          server.ws.send(WORKTREE_EVENT, worktree());
        });
      } catch {
        return;
      }
      // An error event with no listener stops the dev server, for example when git removes the
      // worktree. The label then keeps the last branch.
      watcher.on("error", () => watcher.close());
      server.httpServer?.once("close", () => watcher.close());
    },
  };
}

/** The git directory of a checkout: `.git` itself, or the directory that the `.git` file of a worktree names. */
function findGitDirectory(projectRoot: string): string | null {
  const dotGit = join(projectRoot, ".git");
  try {
    if (statSync(dotGit).isDirectory()) return dotGit;
    const pointer = /^gitdir: (.+)$/mu.exec(readFileSync(dotGit, "utf8"));
    return pointer?.[1] ? resolve(dirname(dotGit), pointer[1].trim()) : null;
  } catch {
    return null;
  }
}

/** The branch name, or the short commit of a detached `HEAD`. */
function readBranch(gitDirectory: string): string | null {
  try {
    const head = readFileSync(join(gitDirectory, "HEAD"), "utf8").trim();
    const reference = /^ref: refs\/heads\/(.+)$/u.exec(head);
    return reference?.[1] ?? (head.slice(0, 8) || null);
  } catch {
    return null;
  }
}
