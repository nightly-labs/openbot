/** Brand marks for integrations. The file imports only plain paths, so the public site can use it without the shared UI root. */

import {
  DISCORD_MARK_PATH,
  GITHUB_MARK_PATH,
  ONEPASSWORD_MARK_PATH,
  PROTON_MARK_PATH,
  SLACK_MARK_PATH,
  TELEGRAM_MARK_PATH,
  WHATSAPP_MARK_PATH,
} from "@openbot/brand/connector-mark-shape";
import type { JSX } from "@solidjs/web";

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

/** WhatsApp's mark, for the same reason. */
export function WhatsAppMark(props: { class?: string | undefined }) {
  return (
    <svg class={props.class} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={WHATSAPP_MARK_PATH} />
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

/**
 * A connector's app icon: its brand color fills the whole square and the mark is on it, as the icon of a
 * catalog app fills its tile. The colors are the Simple Icons brand colors (CC0).
 */
function BrandTile(props: { background: string; children: JSX.Element }) {
  return (
    <svg class="connector-brand-tile" viewBox="-6 -6 36 36" aria-hidden="true">
      <rect x="-6" y="-6" width="36" height="36" fill={props.background} />
      {props.children}
    </svg>
  );
}

/** Slack's four colors, in the order of the arms in the path: bottom left, top left, top right, bottom right. */
const SLACK_ARM_COLORS = ["#E01E5A", "#36C5F0", "#2EB67D", "#ECB22E"] as const;

/** Slack's app icon: the mark in its four colors, on white. Each arm is two parts of the path. */
export function SlackTile() {
  const parts = SLACK_MARK_PATH.split(/(?=M)/);
  return (
    <BrandTile background="#FFFFFF">
      {parts.map((d, index) => (
        <path d={d} fill={SLACK_ARM_COLORS[Math.floor(index / 2)]} />
      ))}
    </BrandTile>
  );
}

export function DiscordTile() {
  return (
    <BrandTile background="#5865F2">
      <path d={DISCORD_MARK_PATH} fill="#FFFFFF" />
    </BrandTile>
  );
}

export function TelegramTile() {
  return (
    <BrandTile background="#26A5E4">
      <path d={TELEGRAM_MARK_PATH} fill="#FFFFFF" />
    </BrandTile>
  );
}

export function WhatsAppTile() {
  return (
    <BrandTile background="#25D366">
      <path d={WHATSAPP_MARK_PATH} fill="#FFFFFF" />
    </BrandTile>
  );
}

export function GitHubTile() {
  return (
    <BrandTile background="#181717">
      <path d={GITHUB_MARK_PATH} fill="#FFFFFF" />
    </BrandTile>
  );
}

export function OnePasswordTile() {
  return (
    <BrandTile background="#3B66BC">
      <path d={ONEPASSWORD_MARK_PATH} fill="#FFFFFF" />
    </BrandTile>
  );
}

/** Bitwarden's shield (Simple Icons, CC0): white, with its right half in the brand color. */
const BITWARDEN_SHIELD_PATH =
  "M5.11 2.92h13.8c.208 0 .388.076.54.228a.737.737 0 01.227.539v9.2c0 .687-.134 1.367-.401 2.042a7.618 7.618 0 01-.995 1.797 11.097 11.097 0 01-1.413 1.528c-.547.495-1.052.906-1.515 1.234-.464.327-.947.636-1.45.928-.503.291-.86.489-1.072.593-.212.104-.381.184-.51.24a.687.687 0 01-.31.071.688.688 0 01-.312-.072 13.784 13.784 0 01-.51-.24 20.61 20.61 0 01-1.071-.592 19.133 19.133 0 01-1.45-.928 16.457 16.457 0 01-1.515-1.234 11.11 11.11 0 01-1.414-1.528 7.617 7.617 0 01-.994-1.797 5.502 5.502 0 01-.401-2.042v-9.2c0-.208.076-.387.227-.54a.737.737 0 01.54-.227z";
const BITWARDEN_HALF_PATH = "M12.01 5.22v13.62c.95-.502 1.801-1.05 2.552-1.64 1.877-1.47 2.815-2.907 2.815-4.313V5.22Z";

export function BitwardenTile() {
  return (
    <BrandTile background="#175DDC">
      <path d={BITWARDEN_SHIELD_PATH} fill="#FFFFFF" />
      <path d={BITWARDEN_HALF_PATH} fill="#175DDC" />
    </BrandTile>
  );
}

export function ProtonPassTile() {
  return (
    <BrandTile background="#6D4AFF">
      <path d={PROTON_MARK_PATH} fill="#FFFFFF" />
    </BrandTile>
  );
}
