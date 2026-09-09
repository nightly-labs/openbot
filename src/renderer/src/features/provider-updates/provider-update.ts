import type { AgentProviderId, ProviderRuntimeStatus } from "@openbot/contracts/ipc";
import { errorMessage } from "../../error-message";

/**
 * A managed provider CLI, and the newer version main says exists for it.
 *
 * Modelled on `UpdateStatus` in the app updater: `availableVersion` arrives
 * already decided, and nothing here compares two version strings. The renderer
 * cannot do that honestly anyway - `isMinimumVersion` lives in `src/backend`,
 * which this directory may not import - and the app updater proves the split
 * works. Main knows what it published; the renderer says so.
 *
 * There is deliberately no second phase enum. An update *is* a re-download of a
 * newer version, so `downloading`, `finishing`, `ready` and `download-error`
 * already carry every in-flight state, and the Cancel and Retry buttons the
 * picker already renders already reverse them.
 */
export interface ProviderUpdate {
  provider: AgentProviderId;
  /** The product name, as the picker shows it - "ChatGPT", "Claude", "Grok". */
  name: string;
  runtime: ProviderRuntimeStatus;
  /**
   * The version main offers for the managed copy, or `null`.
   *
   * `null` for every CLI the user installed themselves: OpenBot does not decide what version those
   * reach. Such an update is still reported here - it is started by hand, so it opens on its
   * running step and settles on the version the CLI came back with, and no state before it claims
   * one is waiting.
   */
  availableVersion: string | null;
}

export interface ProviderUpdatePresentation {
  /** Installed, idle, and a different version exists. The only state that offers an update. */
  updatable: boolean;
  busy: boolean;
  failed: boolean;
  /**
   * The one thing the notification offers, or nothing. A running update offers nothing: it is a
   * download of a version the user has already asked for, it finishes in seconds, and a Cancel that
   * left the runtime half replaced would be the more alarming outcome. The close control is still
   * there, and closing the notification stops nothing.
   */
  actionLabel: "Update" | "Retry" | undefined;
  title: string;
  detail: string;
  /**
   * The download percentage, while the download is what is happening, and `null` everywhere else -
   * including the "Setting up" step, which has no measurable end and shows an indeterminate bar.
   * The toast animates the digits, so it needs the number rather than the sentence.
   */
  progress: number | null;
}

/** An installed runtime with a different version waiting is the whole trigger. */
export function providerUpdateAvailable(runtime: ProviderRuntimeStatus, availableVersion: string | null): boolean {
  return (
    (runtime.phase === "ready" || (runtime.phase === "not-downloaded" && runtime.version !== null)) &&
    availableVersion !== null &&
    availableVersion !== runtime.version
  );
}

export function presentProviderUpdate(update: ProviderUpdate): ProviderUpdatePresentation {
  const { name, runtime, availableVersion } = update;
  const updatable = providerUpdateAvailable(runtime, availableVersion);
  const busy = runtime.phase === "downloading" || runtime.phase === "finishing";
  const failed = runtime.phase === "download-error";

  let actionLabel: ProviderUpdatePresentation["actionLabel"];
  if (updatable) actionLabel = "Update";
  else if (failed) actionLabel = "Retry";

  let title = `${name} is up to date`;
  if (updatable) title = `${name} update available`;
  else if (busy) title = `Updating ${name}`;
  else if (failed) title = `${name} update failed`;

  return {
    updatable,
    busy,
    failed,
    actionLabel,
    title,
    detail: updateDetail(update, updatable),
    progress: runtime.phase === "downloading" ? clampProgress(runtime.progress) : null,
  };
}

/**
 * The installed version, written the way the notification writes one, or `null` for a runtime that
 * reports none.
 *
 * This is a function rather than a string built in the picker so that the row and the notification
 * never disagree about the leading "v". It names one version only, even while a newer one is
 * offered: the row has the badge and the Update button to say an update exists, and the version
 * the user would get is in the notification, which has the width for both.
 */
export function providerVersionLabel(runtime: ProviderRuntimeStatus): string | null {
  return runtime.version ? formatVersion(runtime.version) : null;
}

function versionTransition(version: string | null, availableVersion: string | null): string {
  return `${formatVersion(version)} → ${formatVersion(availableVersion)}`;
}

function updateDetail(update: ProviderUpdate, updatable: boolean): string {
  const { runtime, availableVersion } = update;
  if (updatable || runtime.phase === "downloading") return versionTransition(runtime.version, availableVersion);
  if (runtime.phase === "finishing") return "Setting up";
  if (runtime.phase === "download-error")
    return errorMessage(runtime.message, "The update was interrupted. Try again.");
  return formatVersion(runtime.version ?? availableVersion);
}

function formatVersion(version: string | null): string {
  if (!version) return "unknown version";
  return version.startsWith("v") ? version : `v${version}`;
}

function clampProgress(progress: number | null): number {
  return Math.round(Math.max(0, Math.min(100, progress ?? 0)));
}

/**
 * The providers that crossed into "update available" between two snapshots.
 *
 * This is what keeps the toast from re-firing. Main pushes a snapshot on every
 * revision, so announcing whatever is updatable *now* would raise the same
 * notification on every progress tick of an unrelated provider. Announcing the
 * transition instead means a user who dismissed the toast is left alone until
 * the offer genuinely changes - and a new version after that is a new
 * transition, because the previous entry was updatable for a different
 * `availableVersion`.
 */
export function providerUpdatesToAnnounce(previous: ProviderUpdate[], next: ProviderUpdate[]): ProviderUpdate[] {
  const announced = new Map<AgentProviderId, string>();
  for (const update of previous) {
    if (providerUpdateAvailable(update.runtime, update.availableVersion) && update.availableVersion) {
      announced.set(update.provider, update.availableVersion);
    }
  }
  return next.filter(
    (update) =>
      providerUpdateAvailable(update.runtime, update.availableVersion) &&
      announced.get(update.provider) !== update.availableVersion,
  );
}
