import { Match, Switch } from "solid-js";

export type LandingIconName =
  | "arrow-right"
  | "arrow-up-right"
  | "blocks"
  | "check"
  | "chevron-down"
  | "cloud"
  | "code"
  | "contact"
  | "cpu"
  | "devices"
  | "download"
  | "heart"
  | "laptop"
  | "lock"
  | "phone"
  | "puzzle"
  | "tag"
  | "users";

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
        <Match when={props.name === "check"}>
          <path d="M20 6 9 17l-5-5" />
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
        {/* The topics of a comparison table, one per row. Drawn after the Lucide set the
            desktop app uses, which is not a dependency of this site. */}
        <Match when={props.name === "laptop"}>
          <rect width="18" height="12" x="3" y="4" rx="2" />
          <path d="M2 20h20" />
        </Match>
        <Match when={props.name === "cloud"}>
          <path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9Z" />
        </Match>
        <Match when={props.name === "cpu"}>
          <rect width="14" height="14" x="5" y="5" rx="2" />
          <rect width="6" height="6" x="9" y="9" rx="1" />
          <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
        </Match>
        <Match when={props.name === "users"}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.9" />
          <path d="M16 3.1a4 4 0 0 1 0 7.8" />
        </Match>
        <Match when={props.name === "lock"}>
          <rect width="18" height="11" x="3" y="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </Match>
        <Match when={props.name === "tag"}>
          <path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4Z" />
          <circle cx="7.5" cy="7.5" r="1" />
        </Match>
        <Match when={props.name === "devices"}>
          <path d="M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8" />
          <path d="M10 19v-4M7 19h5" />
          <rect width="6" height="10" x="16" y="12" rx="2" />
        </Match>
        <Match when={props.name === "phone"}>
          <rect width="14" height="20" x="5" y="2" rx="2" />
          <path d="M12 18h.01" />
        </Match>
        <Match when={props.name === "code"}>
          <path d="m16 18 6-6-6-6" />
          <path d="m8 6-6 6 6 6" />
        </Match>
        <Match when={props.name === "heart"}>
          <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />
        </Match>
      </Switch>
    </svg>
  );
}
