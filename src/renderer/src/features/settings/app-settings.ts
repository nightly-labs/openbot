export type ExternalLinkTarget = "Default browser" | "OpenBot";

export interface GeneralSettingsValue {
  launchAtLogin: boolean;
  keepRunningInBackground: boolean;
  restoreLastWorkspace: boolean;
  externalLinkTarget: ExternalLinkTarget;
  desktopNotifications: boolean;
  macBookNotch: boolean;
  macBookNotchHaptics: boolean;
  macBookNotchIdle: boolean;
  macBookNotchAdditionalDisplays: boolean;
  taskCompletionSound: boolean;
  /**
   * Turbo mode. Agents run commands and change files without asking. Permission grants and site
   * publishing still ask, so this is not the same as "no boundary at all".
   */
  turboMode: boolean;
  autoDownloadUpdates: boolean;
  productAnalytics: boolean;
}

export const DEFAULT_GENERAL_SETTINGS: GeneralSettingsValue = {
  launchAtLogin: true,
  keepRunningInBackground: false,
  restoreLastWorkspace: true,
  externalLinkTarget: "Default browser",
  desktopNotifications: true,
  macBookNotch: true,
  macBookNotchHaptics: true,
  macBookNotchIdle: true,
  macBookNotchAdditionalDisplays: true,
  taskCompletionSound: false,
  turboMode: false,
  autoDownloadUpdates: true,
  productAnalytics: true,
};
