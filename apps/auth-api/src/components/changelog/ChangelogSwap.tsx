import { cx, prefersReducedMotion } from "@openbot/ui/utils";
import type { JSX } from "@solidjs/web";
import { type Accessor, createEffect, createSignal, For, untrack } from "solid-js";
import { CHANGELOG_PLATFORMS, type ChangelogPlatform } from "../../lib/changelog";

// A change of tab dissolves one list into the other with the header menu's motion: the list
// being closed leaves through a blur toward the side of the tab that was pressed, and the new one
// comes in through a blur from the other side. Every part of the page that differs by app is its
// own swap, and all of them share one state, so they move as one.

type SwapMotion = "from-start" | "from-end" | "to-start" | "to-end";

interface SwapMotions {
  opened?: SwapMotion;
  closed?: { platform: ChangelogPlatform; motion: SwapMotion };
}

export interface PlatformSwap {
  platform: Accessor<ChangelogPlatform>;
  /** The lists on screen: the open one, and the one still animating out. */
  shown: Accessor<readonly ChangelogPlatform[]>;
  motion: (platform: ChangelogPlatform) => SwapMotion | undefined;
  /** Ends the motion of `platform`, and takes it off the screen when it is not the open one. */
  settle: (platform: ChangelogPlatform) => void;
}

export function createPlatformSwap(platform: Accessor<ChangelogPlatform>): PlatformSwap {
  let current = untrack(platform);
  const [shown, setShown] = createSignal<readonly ChangelogPlatform[]>([current]);
  const [motions, setMotions] = createSignal<SwapMotions>({});

  createEffect(platform, (next) => {
    const previous = current;
    if (next === previous) return;
    current = next;
    // Nothing would end the motion, so the closed list would stay.
    if (prefersReducedMotion()) {
      setMotions({});
      setShown([next]);
      return;
    }
    const forward = CHANGELOG_PLATFORMS.indexOf(next) > CHANGELOG_PLATFORMS.indexOf(previous);
    setMotions({
      opened: forward ? "from-end" : "from-start",
      closed: { platform: previous, motion: forward ? "to-start" : "to-end" },
    });
    // A list older than `previous` has lost its motion, and with it the animation that kept it
    // visible.
    setShown([previous, next]);
  });

  return {
    platform,
    shown,
    motion: (candidate) => {
      const { opened, closed } = motions();
      if (candidate === platform()) return opened;
      return closed?.platform === candidate ? closed.motion : undefined;
    },
    settle: (candidate) => {
      if (candidate === current) {
        setMotions(({ closed }) => (closed ? { closed } : {}));
        return;
      }
      setMotions(({ opened }) => (opened ? { opened } : {}));
      setShown((list) => list.filter((entry) => entry !== candidate));
    },
  };
}

export interface ChangelogSwapProps {
  swap: PlatformSwap;
  class?: string;
  panelClass?: string;
  children: (platform: ChangelogPlatform) => JSX.Element;
}

export function ChangelogSwap(props: ChangelogSwapProps) {
  return (
    <div class={cx("changelog-swap", props.class)}>
      <For each={props.swap.shown()}>
        {(platform) => (
          <div
            class={cx("changelog-swap-panel", props.panelClass)}
            data-motion={props.swap.motion(platform)}
            inert={platform !== props.swap.platform()}
            onAnimationEnd={(event) => {
              // A release inside has its own entrance, and its end bubbles up to here.
              if (event.target === event.currentTarget) props.swap.settle(platform);
            }}
          >
            {props.children(platform)}
          </div>
        )}
      </For>
    </div>
  );
}
