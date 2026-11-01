/** Brand marks for integrations. The file imports only plain paths, so the public site can use it without the shared UI root. */

import {
  DISCORD_MARK_PATH,
  GITHUB_MARK_PATH,
  ONEPASSWORD_MARK_PATH,
  SLACK_MARK_PATH,
  TELEGRAM_ICON_GRADIENT,
  TELEGRAM_MARK_PATH,
} from "@openbot/brand/connector-mark-shape";
import { createUniqueId } from "solid-js";

/** GitHub's mark. Lucide has no brand icons, so the path is GitHub's own. */
export function GitHubMark(props: { class?: string | undefined }) {
  return (
    <svg class={props.class} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={GITHUB_MARK_PATH} />
    </svg>
  );
}

/** Slack's mark, for the same reason. */
export function SlackMark(props: { class?: string | undefined }) {
  return (
    <svg class={props.class} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={SLACK_MARK_PATH} />
    </svg>
  );
}

/** Discord's mark, for the same reason. */
export function DiscordMark(props: { class?: string | undefined }) {
  return (
    <svg class={props.class} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={DISCORD_MARK_PATH} />
    </svg>
  );
}

/** Telegram's mark, for the same reason. */
export function TelegramMark(props: { class?: string | undefined }) {
  return (
    <svg class={props.class} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={TELEGRAM_MARK_PATH} />
    </svg>
  );
}

/**
 * The Telegram account connector's mark: the paper plane on Telegram's blue gradient, as Telegram's
 * own app icon draws it. It fills its tile, so it is told apart from the OpenBot Telegram bot at a
 * glance.
 */
export function TelegramAccountMark(props: { class?: string | undefined }) {
  const gradient = `${createUniqueId()}-telegram-account`;
  return (
    <svg class={["brand-mark-tile", props.class].filter(Boolean).join(" ")} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color={TELEGRAM_ICON_GRADIENT.top} />
          <stop offset="1" stop-color={TELEGRAM_ICON_GRADIENT.bottom} />
        </linearGradient>
      </defs>
      <rect width="24" height="24" fill={`url(#${gradient})`} />
      <path d={TELEGRAM_MARK_PATH} fill="#fff" transform="translate(4.7 4.9) scale(0.6)" />
    </svg>
  );
}

/** 1Password's mark, for the same reason. */
export function OnePasswordMark(props: { class?: string | undefined }) {
  return (
    <svg class={props.class} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={ONEPASSWORD_MARK_PATH} />
    </svg>
  );
}

const X_MARK_PATH =
  "M17.5 3h3.2l-7 8 8.2 10h-6.4l-5-6.5L4.7 21H1.5l7.5-8.5L1.1 3h6.5l4.5 6 5.4-6Zm-1.1 16h1.8L7.6 4.9H5.7L16.4 19Z";

/** The X mark, for the same reason. The public site footer draws the same path. */
export function XMark(props: { class?: string | undefined }) {
  return (
    <svg class={props.class} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={X_MARK_PATH} />
    </svg>
  );
}
