import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { LandingHair, LandingPerson } from "../../lib/landing-content";

/** A circle of radius `r` at (`x`, `y`), as one subpath. */
const curl = (x: number, y: number, r: number) =>
  `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

/**
 * Hair in front of the head. Each path is filled on its own, so curls that overlap the cap do not
 * make holes in it.
 */
const HAIR_FRONT: Record<LandingHair, readonly string[]> = {
  long: [
    "M12.2 18C11.9 10.9 15.5 7.9 20 7.9S28.1 10.9 27.8 18C27.1 14.6 25.3 12.5 22.2 11.9C20.4 14.4 16.4 16.3 12.2 18Z",
  ],
  short: [
    "M12.1 17.2C11.5 10.4 15.1 7.2 20.2 7.2C25 7.2 28.6 10 27.9 17.2C27.3 14.4 26 12.9 24 12.6C21 13.9 16.7 13.6 14.3 12.8C13.1 13.9 12.4 15.4 12.1 17.2Z",
  ],
  curly: [
    "M12.6 15.4C13.2 11 16.1 9.2 20 9.2S26.8 11 27.4 15.4C25.4 13.4 23 12.6 20 12.6S14.6 13.4 12.6 15.4Z",
    [
      curl(12.9, 15.6, 2.5),
      curl(13.7, 11.7, 2.8),
      curl(16.7, 8.9, 3),
      curl(20.2, 7.9, 3.2),
      curl(23.8, 8.9, 3),
      curl(26.6, 11.7, 2.8),
      curl(27.1, 15.6, 2.5),
    ].join(""),
  ],
};

/** Hair behind the head, for long hair only. */
const HAIR_BACK: Record<LandingHair, string | null> = {
  long: "M10.6 19.5C10.3 9.8 14.7 6.6 20 6.6S29.7 9.8 29.4 19.5V32C27.4 33.6 12.6 33.6 10.6 32Z",
  short: null,
  curly: null,
};

/** Three freckles on each cheek. */
const FRECKLES = [
  [15, 20.7],
  [16.1, 21.3],
  [15.3, 21.9],
  [25, 20.7],
  [23.9, 21.3],
  [24.7, 21.9],
] as const;

interface LandingFaceProps {
  person: LandingPerson;
  class: string;
}

/**
 * A drawn face for a person in a picture. People get faces and agents get avatars, so the two are
 * easy to tell apart. The colours of each person are in the stylesheet, under `data-person`.
 */
export function LandingFace(props: LandingFaceProps): JSX.Element {
  return (
    <span class={`${props.class} landing-face`} data-person={props.person.id}>
      <svg class="landing-face-art" viewBox="0 0 40 40" aria-hidden="true">
        <Show when={HAIR_BACK[props.person.hair]}>{(path) => <path class="landing-face-hair" d={path()} />}</Show>
        <path class="landing-face-shirt" d="M5 42C5 33.4 11 29.6 20 29.6S35 33.4 35 42Z" />
        <path class="landing-face-skin" d="M17.2 23h5.6v7.4c0 1.6-5.6 1.6-5.6 0Z" />
        <path class="landing-face-shade" d="M17.2 24.6c1.8 1.3 3.8 1.3 5.6 0v1.8c-1.8 1-3.8 1-5.6 0Z" />
        <circle class="landing-face-skin" cx="12.5" cy="19.2" r="1.9" />
        <circle class="landing-face-skin" cx="27.5" cy="19.2" r="1.9" />
        <ellipse class="landing-face-skin" cx="20" cy="18" rx="7.6" ry="8.3" />
        <For each={HAIR_FRONT[props.person.hair]}>{(path) => <path class="landing-face-hair" d={path} />}</For>
        <path class="landing-face-brow" d="M15.4 16q1.5-.9 3 0M21.6 16q1.5-.9 3 0" />
        <ellipse class="landing-face-ink" cx="16.9" cy="18.7" rx="0.95" ry="1.15" />
        <ellipse class="landing-face-ink" cx="23.1" cy="18.7" rx="0.95" ry="1.15" />
        <circle class="landing-face-blush" cx="15.2" cy="21.4" r="1.4" />
        <circle class="landing-face-blush" cx="24.8" cy="21.4" r="1.4" />
        <Show when={props.person.detail === "freckles"}>
          <For each={FRECKLES}>
            {(point) => <circle class="landing-face-freckle" cx={point[0]} cy={point[1]} r="0.35" />}
          </For>
        </Show>
        <Show when={props.person.detail === "glasses"}>
          <g class="landing-face-glasses">
            <circle cx="16.9" cy="18.7" r="2.3" />
            <circle cx="23.1" cy="18.7" r="2.3" />
            <path d="M19.2 18.5q.8-.5 1.6 0" />
          </g>
        </Show>
        <path class="landing-face-mouth" d="M18.3 22.5h3.4c-.3 1.4-3.1 1.4-3.4 0Z" />
      </svg>
    </span>
  );
}
