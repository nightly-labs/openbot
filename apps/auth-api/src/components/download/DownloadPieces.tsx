import { PlatformLogo } from "@openbot/brand";
import { Link } from "@tanstack/solid-router";
import { createSignal, onCleanup } from "solid-js";
import { DOWNLOAD_PAGES, type DownloadInstaller } from "../../lib/download-pages";
import type { DownloadPlatform } from "../../lib/download-platforms";
import { LandingIcon } from "../landing/LandingIcon";

export interface InstallerButtonProps {
  installer: DownloadInstaller;
  /** The first installer is filled; the others are outlined. */
  primary: boolean;
  /** Inside a card that already names the system, the button shows only the processor. */
  short?: boolean;
}

/**
 * A direct installer link for a coloured panel or card: dark on the system's colour. A plain anchor,
 * because the link answers with a redirect to a file and the router must not try to render it.
 */
export function InstallerButton(props: InstallerButtonProps) {
  return (
    <a
      class="download-installer-button"
      data-variant={props.primary ? "primary" : "secondary"}
      href={props.installer.href}
      aria-label={props.short ? props.installer.label : undefined}
    >
      <LandingIcon name="download" class="download-installer-icon" />
      {props.short ? props.installer.shortLabel : props.installer.label}
    </a>
  );
}

const COPIED_FOR_MS = 1600;

/** A shell command with a copy button. The text stays selectable when the clipboard is not allowed. */
export function CommandBlock(props: { code: string }) {
  const [copied, setCopied] = createSignal(false);
  let reset: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(reset));

  async function copy() {
    try {
      await navigator.clipboard.writeText(props.code);
    } catch {
      return;
    }
    setCopied(true);
    clearTimeout(reset);
    reset = setTimeout(() => setCopied(false), COPIED_FOR_MS);
  }

  return (
    <div class="download-command">
      <pre>
        <code>{props.code}</code>
      </pre>
      <button type="button" class="download-command-copy" data-state={copied() ? "copied" : "idle"} onClick={copy}>
        <LandingIcon name={copied() ? "check" : "code"} class="download-command-copy-icon" />
        <span aria-live="polite">{copied() ? "Copied" : "Copy"}</span>
      </button>
    </div>
  );
}

/** A small card in the system's colour that opens its page. */
export function SystemCard(props: { platform: DownloadPlatform }) {
  const page = () => DOWNLOAD_PAGES[props.platform];
  return (
    <Link
      class="download-system-card"
      data-download-platform={props.platform}
      to="/download/$platform"
      params={{ platform: props.platform }}
    >
      <PlatformLogo platform={props.platform} class="download-system-card-logo" />
      <span class="download-system-card-copy">
        <span class="download-system-card-name">{page().heading}</span>
        <span class="download-system-card-detail">
          {page().specs[0]?.value}, {page().specs[1]?.value}
        </span>
      </span>
      <LandingIcon name="arrow-right" class="download-system-card-arrow" />
    </Link>
  );
}
