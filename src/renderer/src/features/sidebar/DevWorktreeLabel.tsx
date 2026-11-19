import { Show } from "solid-js";
import { devWorktree } from "../../dev-worktree";

export function DevWorktreeLabel() {
  return (
    <Show when={devWorktree()?.branch}>
      {(branch) => (
        <span class="dev-worktree-label" dir="ltr">
          <span class="dev-worktree-label-dot" aria-hidden="true" />
          <span class="dev-worktree-label-name">{branch()}</span>
        </span>
      )}
    </Show>
  );
}
