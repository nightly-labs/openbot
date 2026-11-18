import { Show } from "solid-js";
import { devWorktree } from "../../dev-worktree";

/**
 * The branch of the worktree that serves this dev renderer, with a dot in the worktree color of the
 * Dock icon. It shows nothing in a build, Storybook and Vitest.
 */
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
