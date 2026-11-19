import { createSignal } from "solid-js";

interface DevWorktree {
  readonly branch: string | null;
  readonly color: string;
}

const [worktree, setWorktree] = createSignal<DevWorktree | null>(null);

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
