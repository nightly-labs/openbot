import { type FSWatcher, readFileSync, statSync, watch } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Plugin } from "vite";
import { developmentWorktreeColor } from "../src/main/development-profile";

const REQUEST_EVENT = "openbot:dev-worktree-request";
const WORKTREE_EVENT = "openbot:dev-worktree";

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
      watcher.on("error", () => watcher.close());
      server.httpServer?.once("close", () => watcher.close());
    },
  };
}

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

function readBranch(gitDirectory: string): string | null {
  try {
    const head = readFileSync(join(gitDirectory, "HEAD"), "utf8").trim();
    const reference = /^ref: refs\/heads\/(.+)$/u.exec(head);
    return reference?.[1] ?? (head.slice(0, 8) || null);
  } catch {
    return null;
  }
}
