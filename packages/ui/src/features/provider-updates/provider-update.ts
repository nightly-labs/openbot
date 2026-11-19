import type { AgentProviderId, ProviderRuntimeStatus } from "@openbot/contracts/ipc";
import { currentText, type TextValue } from "../../text";

type UpdateText = Pick<TextValue, "t" | "errorMessage">;

export interface ProviderUpdate {
  provider: AgentProviderId;
  name: string;
  runtime: ProviderRuntimeStatus;
  availableVersion: string | null;
  checking?: boolean;
  install?: boolean;
}

export interface ProviderUpdatePresentation {
  updatable: boolean;
  busy: boolean;
  failed: boolean;
  actionLabel: string | undefined;
  title: string;
  detail: string;
  progress: number | null;
}

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
  const waiting = runtime.phase === "downloading" && runtime.message !== null;
  const failed = runtime.phase === "download-error";

  let actionLabel: ProviderUpdatePresentation["actionLabel"];
  if (updatable) actionLabel = t("update.provider.update");
  else if (failed) actionLabel = t("common.retry");

  let title = t("update.provider.upToDate", { name });
  if (update.checking) title = t("update.provider.checking", { name });
  else if (updatable) title = t("update.provider.available", { name });
  else if (waiting) title = t("update.provider.waiting", { name });
  else if (busy) title = t(update.install ? "update.provider.downloading" : "update.provider.updating", { name });
  else if (failed) title = t(update.install ? "update.provider.downloadFailed" : "update.provider.failed", { name });
  else if (update.install) title = t("update.provider.downloaded", { name });

  return {
    updatable,
    busy,
    failed,
    actionLabel,
    title,
    detail: updateDetail(update, updatable, text),
    progress: !update.checking && runtime.phase === "downloading" && !waiting ? clampProgress(runtime.progress) : null,
  };
}

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
  if (update.install) return installDetail(update, text);
  if (runtime.phase === "downloading" && runtime.message !== null)
    return text.errorMessage(runtime.message, versionTransition(runtime.version, availableVersion, text));
  if (updatable || runtime.phase === "downloading") return versionTransition(runtime.version, availableVersion, text);
  if (runtime.phase === "finishing") return text.t("update.provider.settingUp");
  if (runtime.phase === "download-error")
    return text.errorMessage(runtime.message, text.t("update.provider.failedRetry"));
  return formatVersion(runtime.version ?? availableVersion, text);
}

function installDetail(update: ProviderUpdate, text: UpdateText): string {
  const { runtime, availableVersion } = update;
  if (runtime.phase === "finishing") return text.t("update.provider.settingUp");
  if (runtime.phase === "download-error")
    return text.errorMessage(runtime.message, text.t("update.provider.downloadFailedRetry"));
  const version = runtime.version ?? availableVersion;
  return version ? formatVersion(version, text) : "";
}

function formatVersion(version: string | null, text: Pick<TextValue, "t">): string {
  if (!version) return text.t("update.provider.unknownVersion");
  return version.startsWith("v") ? version : `v${version}`;
}

function clampProgress(progress: number | null): number {
  return Math.round(Math.max(0, Math.min(100, progress ?? 0)));
}

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
