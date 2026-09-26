import type { AgentProviderId, ProviderRuntimeStatus } from "@openbot/contracts/ipc";
import { currentText, type TextValue } from "../../text";

/** The part of the interface text that the presenters read. */
type UpdateText = Pick<TextValue, "t" | "errorMessage">;

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
  availableVersion: string | null;
  /** The user asked main whether a newer version exists, and the answer has not arrived. */
  checking?: boolean;
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
  actionLabel: string | undefined;
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

export function presentProviderUpdate(
  update: ProviderUpdate,
  text: UpdateText = currentText(),
): ProviderUpdatePresentation {
  const { t } = text;
  const { name, runtime, availableVersion } = update;
  const updatable = providerUpdateAvailable(runtime, availableVersion);
  const busy = update.checking === true || runtime.phase === "downloading" || runtime.phase === "finishing";
  const failed = runtime.phase === "download-error";

  let actionLabel: ProviderUpdatePresentation["actionLabel"];
  if (updatable) actionLabel = t("update.provider.update");
  else if (failed) actionLabel = t("common.retry");

  let title = t("update.provider.upToDate", { name });
  if (update.checking) title = t("update.provider.checking", { name });
  else if (updatable) title = t("update.provider.available", { name });
  else if (busy) title = t("update.provider.updating", { name });
  else if (failed) title = t("update.provider.failed", { name });

  return {
    updatable,
    busy,
    failed,
    actionLabel,
    title,
    detail: updateDetail(update, updatable, text),
    progress: !update.checking && runtime.phase === "downloading" ? clampProgress(runtime.progress) : null,
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
export function providerVersionLabel(
  runtime: ProviderRuntimeStatus,
  text: Pick<TextValue, "t"> = currentText(),
): string | null {
  return runtime.version ? formatVersion(runtime.version, text) : null;
}

function versionTransition(version: string | null, availableVersion: string | null, text: UpdateText): string {
  return `${formatVersion(version, text)} → ${formatVersion(availableVersion, text)}`;
}

function updateDetail(update: ProviderUpdate, updatable: boolean, text: UpdateText): string {
  const { runtime, availableVersion } = update;
  if (updatable || runtime.phase === "downloading") return versionTransition(runtime.version, availableVersion, text);
  if (runtime.phase === "finishing") return text.t("update.provider.settingUp");
  if (runtime.phase === "download-error")
    return text.errorMessage(runtime.message, text.t("update.provider.interrupted"));
  return formatVersion(runtime.version ?? availableVersion, text);
}

function formatVersion(version: string | null, text: Pick<TextValue, "t">): string {
  if (!version) return text.t("update.provider.unknownVersion");
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
