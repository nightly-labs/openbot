import { createSignal } from "solid-js";

/** What `scripts/dev-worktree-vite-plugin.ts` sends. */
interface DevWorktree {
  readonly branch: string | null;
  readonly color: string;
}

const [worktree, setWorktree] = createSignal<DevWorktree | null>(null);

/**
 * The worktree of a dev renderer that Vite serves. It sets the dev logo color to the worktree color,
 * the color of the Dock icon too, and keeps the branch name current when git renames the branch. A
 * build, Storybook and Vitest have no such worktree, so the value stays `null`.
 *
 * The module subscribes when it loads, not when an entry calls it: an HMR update runs this module
 * again with a new signal, and the new signal must ask for the worktree again.
 */
const hot = import.meta.hot;
if (hot) {
  const apply = (next: DevWorktree) => {
    setWorktree(next);
    document.documentElement.style.setProperty("--openbot-logo-dev", next.color);
  };
  hot.on("openbot:dev-worktree", apply);
  hot.send("openbot:dev-worktree-request");
  hot.dispose(() => hot.off("openbot:dev-worktree", apply));
}

export const devWorktree = worktree;
