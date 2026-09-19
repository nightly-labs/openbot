import { Match, Switch } from "solid-js";

export type LandingIconName =
  | "arrow-right"
  | "arrow-up-right"
  | "blocks"
  | "chevron-down"
  | "contact"
  | "download"
  | "heart"
  | "puzzle";

export interface LandingIconProps {
  name: LandingIconName;
  class?: string;
  label?: string;
}

export function LandingIcon(props: LandingIconProps) {
  return (
    <svg
      class={props.class}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden={props.label ? undefined : "true"}
      aria-label={props.label}
      role={props.label ? "img" : undefined}
      data-icon={props.name}
    >
      <Switch>
        <Match when={props.name === "download"}>
          <path d="M12 3v12" />
          <path d="m7 10 5 5 5-5" />
          <path d="M5 21h14" />
        </Match>
        <Match when={props.name === "contact"}>
          <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
        </Match>
        <Match when={props.name === "chevron-down"}>
          <path d="m6 9 6 6 6-6" />
        </Match>
        <Match when={props.name === "arrow-right"}>
          <path d="M4 12h16" />
          <path d="m14 6 6 6-6 6" />
        </Match>
        <Match when={props.name === "arrow-up-right"}>
          <path d="M7 17 17 7" />
          <path d="M7 7h10v10" />
        </Match>
        {/* What kind of thing a row on a plugin page is: an app, or a skill. The pair is the
            one the desktop app already uses for the same two lists. */}
        <Match when={props.name === "puzzle"}>
          <path d="M15.4 4.4a1 1 0 0 0 1.7-.5 2.5 2.5 0 1 1 3 3 1 1 0 0 0-.5 1.7l1.7 1.7a2.4 2.4 0 0 1 0 3.4l-1.7 1.7a1 1 0 0 1-1.7-.5 2.5 2.5 0 1 0-3 3 1 1 0 0 1 .5 1.7l-1.7 1.7a2.4 2.4 0 0 1-3.4 0l-1.7-1.7a1 1 0 0 0-1.7.5 2.5 2.5 0 1 1-3-3 1 1 0 0 0 .5-1.7l-1.7-1.7a2.4 2.4 0 0 1 0-3.4l1.7-1.7a1 1 0 0 1 1.7.5 2.5 2.5 0 1 0 3-3 1 1 0 0 1-.5-1.7Z" />
        </Match>
        <Match when={props.name === "blocks"}>
          <rect width="7" height="7" x="14" y="3" rx="1" />
          <path d="M10 21V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3" />
        </Match>
        <Match when={props.name === "heart"}>
          <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />
        </Match>
      </Switch>
    </svg>
  );
}
