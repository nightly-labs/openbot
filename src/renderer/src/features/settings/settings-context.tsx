import {
  AGENT_DEFAULT_KEYS,
  type ApprovalAutomationPreference,
  agentAutoApprovalEnabled,
  type DynamicIslandGeometry,
  type ExternalLinkTarget,
} from "@openbot/contracts/ipc";
import { DEFAULT_GENERAL_SETTINGS, type GeneralSettingsValue } from "@openbot/ui/features/settings/app-settings";
import { currentText } from "@openbot/ui/text";
import { createEffect, createSignal, flush, onSettled } from "solid-js";
import { isActionSoundEnabled, readActionSoundTheme, setActionSoundChoice } from "../../action-sounds";
import { actionToast } from "../../action-toast";
import { readShowAgentSteps, setShowAgentSteps, useShowAgentSteps } from "../../agent-steps-preference";
import { desktopAnalytics } from "../../analytics";
import { playSoundChoice, readTaskSound, setTaskSound } from "../../completion-sound";
import { usePlatform } from "../../platform";
import { readSendShortcutMode, setSendShortcutMode, useSendShortcutMode } from "../../send-shortcut-preference";
import { createSimpleContext } from "../../simple-context";
import { useAuth } from "../account/account-context";
import { useSetup } from "../onboarding/onboarding-context";
import { settingsPort } from "./settings-port";
import { isOpenSettingsShortcut } from "./settings-shortcut";
import type { SettingsTab } from "./settings-tabs";

const ANALYTICS_APP_VERSION_STORAGE_KEY = "openbot:analytics-app-version";

function sameExternalLinkTarget(left: ExternalLinkTarget, right: ExternalLinkTarget): boolean {
  return left.kind === right.kind && (left.kind !== "app" || right.kind !== "app" || left.path === right.path);
}

/** Tells the user why a switch went back to its previous value. */
function showSaveFailure(error: unknown): void {
  const { t, errorMessage } = currentText();
  actionToast.error(errorMessage(error, t("settings.preferences.saveFailed")), {
    // One save can revert two switches, such as both notification switches. The id shows one toast.
    id: "settings-preference-save-failed",
    report: { operation: "settings", source: "action", cause_code: "unknown" },
  });
}

/**
 * Application-wide preferences and the two surfaces that edit them: the
 * settings page and the skills marketplace.
 *
 * Ungated - every preference has a default the app runs on, so nothing waits
 * for the three reads below. `analyticsPreferenceLoaded()` is `null` until the
 * first of them resolves, which is what keeps analytics silent rather than
 * opted-in-by-default during startup.
 *
 * Three preferences, three owners in main: analytics, the updater and the
 * Dynamic Island each persist their own, so `updateGeneralSettings` diffs the
 * incoming value field by field and calls only the owners whose fields moved.
 * Each call sets optimistically and reverts its own fields on failure, which is
 * why the reverts are per-branch rather than one restore of `previous`.
 */
const Settings = createSimpleContext({
  name: "Settings",
  init: () => {
    const platform = usePlatform();
    const { appInfo, landingPreview } = platform;
    const { centralAuth } = useAuth();
    const { setupState } = useSetup();

    const [analyticsPreferenceLoaded, setAnalyticsPreferenceLoaded] = createSignal<boolean | null>(null);
    /**
     * The state of the preference reads below. "failed" when one or more reads failed: the rows of
     * that read show defaults, not the saved values, so the settings page tells the user and offers
     * a retry.
     */
    const [preferencesLoad, setPreferencesLoad] = createSignal<"loading" | "loaded" | "failed">("loading");
    const [skillsMarketplaceOpen, setSkillsMarketplaceOpen] = createSignal(false);
    // Undefined until main answers. The Settings preview then draws the notch it had before.
    const [builtInDisplayGeometry, setBuiltInDisplayGeometry] = createSignal<DynamicIslandGeometry | undefined>();
    /**
     * The plugin an `openbot://plugins/<slug>` link asked for, held beside the open flag because the
     * marketplace is loaded lazily: the slug has to outlive the chunk load that shows it. It is a
     * slug and never a listing, so the link cannot describe what the user is about to install.
     */
    const [pendingPluginSlug, setPendingPluginSlug] = createSignal<string | null>(null);
    /**
     * Set with the slug when the person pressed Connect on a suggestion card in the chat, so the
     * page starts the connect step. A link never sets it.
     */
    const [pendingPluginConnect, setPendingPluginConnect] = createSignal(false);
    /**
     * The template an `openbot://agents/<id>` link named. The install dialog reads the template by
     * this id and installs only after the user presses Add agent.
     */
    const [pendingAgentTemplateId, setPendingAgentTemplateId] = createSignal<string | null>(null);
    const [appSettingsOpen, setAppSettingsOpen] = createSignal(false);
    /** Counts each open request, so the settings page can tell a new request while it is open. */
    const [appSettingsOpenRequest, setAppSettingsOpenRequest] = createSignal(0);
    /** The tab that the next opening shows. Undefined keeps the tab that was open last. */
    const [appSettingsTab, setAppSettingsTab] = createSignal<SettingsTab | undefined>();
    /** The server that the Notifications tab shows first. Each nonce moves to it once. */
    const [notificationFocusRequest, setNotificationFocusRequest] = createSignal<{
      serverId: string;
      nonce: number;
    } | null>(null);
    let notificationFocusNonce = 0;
    // A request moves the tab once. A later opening of the settings shows the tab from the top.
    createEffect(appSettingsOpen, (open) => {
      if (!open) setNotificationFocusRequest(null);
    });
    /** A hosted server that the server menu asked to delete. The nonce repeats a request for the same server. */
    const [hostedServerDeleteRequest, setHostedServerDeleteRequest] = createSignal<{
      serverId: string;
      nonce: number;
    } | null>(null);
    let hostedServerDeleteNonce = 0;
    const [generalSettings, setGeneralSettings] = createSignal<GeneralSettingsValue>({
      ...DEFAULT_GENERAL_SETTINGS,
      taskSound: readTaskSound(),
      sendShortcut: readSendShortcutMode(),
      showAgentSteps: readShowAgentSteps(),
      soundFeedback: isActionSoundEnabled(),
      soundTheme: readActionSoundTheme(),
    });
    // The mode also changes outside this dialog: another window, or the web Preferences tab on
    // the same page. The shared signal carries those changes into the displayed settings value.
    // Two-arg form: compute tracks the signal, apply writes the store outside tracking.
    const sendShortcutMode = useSendShortcutMode();
    createEffect(
      () => sendShortcutMode(),
      (mode) => {
        setGeneralSettings((current) => (current.sendShortcut === mode ? current : { ...current, sendShortcut: mode }));
      },
    );
    const showAgentSteps = useShowAgentSteps();
    createEffect(
      () => showAgentSteps(),
      (show) => {
        setGeneralSettings((current) =>
          current.showAgentSteps === show ? current : { ...current, showAgentSteps: show },
        );
      },
    );
    const [approvalAutomation, setApprovalAutomation] = createSignal<ApprovalAutomationPreference>({
      defaultAutoApprove: false,
      autoApproveOverrides: {},
    });
    let appSettingsRestoreTarget: HTMLElement | null = null;
    let analyticsOpened = false;
    let analyticsVersionRecorded = false;
    let autoDownloadUpdatesChanged = false;
    let allowRemoteUpdatesChanged = false;
    let autoInstallUpdatesChanged = false;
    let notificationPreferenceChanged = false;
    let busyMessageModeChanged = false;
    let agentDefaultsChanged = false;
    let agentMemoryLimitChanged = false;
    let keepRemoteSessionsChanged = false;
    let externalLinkTargetChanged = false;
    let launchAtLoginChanged = false;
    let keepRunningInBackgroundChanged = false;
    let keepAwakeChanged = false;
    let keepAwakeOnBatteryChanged = false;

    createEffect(
      () => ({
        info: appInfo(),
        setup: setupState(),
        auth: centralAuth(),
        analyticsEnabled: analyticsPreferenceLoaded(),
      }),
      ({ info, setup, auth, analyticsEnabled }) => {
        if (analyticsEnabled === null) return;
        if (landingPreview) return;
        desktopAnalytics.setTrackingEnabled(analyticsEnabled);
        desktopAnalytics.setUser(auth.status === "signed_in" ? auth.user : null);
        if (!platform.appInfoLoadedFromHost() || !info || !setup || auth.status === "loading") return;
        if (!desktopAnalytics.configure(info)) return;
        if (!analyticsVersionRecorded) {
          analyticsVersionRecorded = true;
          try {
            const previousVersion = window.localStorage.getItem(ANALYTICS_APP_VERSION_STORAGE_KEY);
            if (previousVersion && previousVersion !== info.version) {
              desktopAnalytics.track("app_updated", { from_version: previousVersion, to_version: info.version });
            }
            window.localStorage.setItem(ANALYTICS_APP_VERSION_STORAGE_KEY, info.version);
          } catch {
            // Version attribution is optional and must not block startup.
          }
        }
        // A chat window is not another start of the app.
        if (analyticsOpened || platform.chatWindow) return;
        analyticsOpened = true;
        desktopAnalytics.track("desktop_app_opened", {
          setup_completed: setup.completed,
          signed_in: auth.status === "signed_in",
        });
      },
    );

    let dynamicIslandSaveCount = 0;

    /**
     * `analyticsChosen` is false for a default that the user did not change, such as the first-run
     * box left as it was. Only a choice goes to the account.
     */
    function updateGeneralSettings(value: GeneralSettingsValue, options: { analyticsChosen?: boolean } = {}): void {
      const previous = generalSettings();
      function persistField<Key extends keyof GeneralSettingsValue, Response>(
        key: Key,
        request: Promise<Response>,
        read: (response: Response) => GeneralSettingsValue[Key],
      ): void {
        void request
          .then((response) => setGeneralSettings((current) => ({ ...current, [key]: read(response) })))
          .catch((error: unknown) => {
            setGeneralSettings((current) => ({ ...current, [key]: previous[key] }));
            showSaveFailure(error);
          });
      }

      setGeneralSettings(value);
      if (previous.taskSound !== value.taskSound) {
        setTaskSound(value.taskSound);
        playSoundChoice(value.taskSound);
      }
      if (previous.sendShortcut !== value.sendShortcut) {
        setSendShortcutMode(value.sendShortcut);
      }
      if (previous.showAgentSteps !== value.showAgentSteps) {
        setShowAgentSteps(value.showAgentSteps);
      }
      if (previous.soundFeedback !== value.soundFeedback || previous.soundTheme !== value.soundTheme) {
        setActionSoundChoice(value.soundFeedback ? value.soundTheme : "off");
      }
      // A choice equal to the shown default is still a choice, and the account gets it.
      if (previous.productAnalytics !== value.productAnalytics || options.analyticsChosen === true) {
        desktopAnalytics.setTrackingEnabled(value.productAnalytics, { recordOptOut: true });
        setAnalyticsPreferenceLoaded(value.productAnalytics);
        void settingsPort()
          .setAnalyticsPreference({
            enabled: value.productAnalytics,
            ...(options.analyticsChosen === false ? {} : { chosen: true }),
          })
          .then((preference) => {
            desktopAnalytics.setTrackingEnabled(preference.enabled);
            setAnalyticsPreferenceLoaded(preference.enabled);
            setGeneralSettings((current) => ({ ...current, productAnalytics: preference.enabled }));
          })
          .catch((error: unknown) => {
            desktopAnalytics.setTrackingEnabled(previous.productAnalytics);
            setAnalyticsPreferenceLoaded(previous.productAnalytics);
            setGeneralSettings((current) => ({ ...current, productAnalytics: previous.productAnalytics }));
            showSaveFailure(error);
          });
      }
      if (previous.autoDownloadUpdates !== value.autoDownloadUpdates) {
        autoDownloadUpdatesChanged = true;
        persistField(
          "autoDownloadUpdates",
          settingsPort().update.setPreference({ autoDownload: value.autoDownloadUpdates }),
          (preference) => preference.autoDownload,
        );
      }
      if (previous.allowRemoteUpdates !== value.allowRemoteUpdates) {
        allowRemoteUpdatesChanged = true;
        persistField(
          "allowRemoteUpdates",
          settingsPort().update.setPreference({ allowRemoteUpdates: value.allowRemoteUpdates }),
          (preference) => preference.allowRemoteUpdates,
        );
      }
      if (previous.autoInstallUpdates !== value.autoInstallUpdates) {
        autoInstallUpdatesChanged = true;
        persistField(
          "autoInstallUpdates",
          settingsPort().update.setPreference({ autoInstall: value.autoInstallUpdates }),
          (preference) => preference.autoInstall,
        );
      }
      if (
        previous.desktopNotifications !== value.desktopNotifications ||
        previous.notificationPreview !== value.notificationPreview
      ) {
        notificationPreferenceChanged = true;
        const saved = settingsPort().notifications.setPreference({
          desktopNotifications: value.desktopNotifications,
          messagePreview: value.notificationPreview,
        });
        // Each answer writes back only the switch that this change set, so that an older answer does
        // not undo a later change of the other switch.
        if (previous.desktopNotifications !== value.desktopNotifications)
          persistField("desktopNotifications", saved, (preference) => preference.desktopNotifications);
        if (previous.notificationPreview !== value.notificationPreview)
          persistField("notificationPreview", saved, (preference) => preference.messagePreview);
      }
      if (previous.busyMessageMode !== value.busyMessageMode) {
        busyMessageModeChanged = true;
        persistField(
          "busyMessageMode",
          settingsPort().setBusyMessageModePreference({ mode: value.busyMessageMode }),
          (preference) => preference.mode,
        );
      }
      if (AGENT_DEFAULT_KEYS.some((key) => previous.agentDefaults[key] !== value.agentDefaults[key])) {
        agentDefaultsChanged = true;
        persistField("agentDefaults", settingsPort().setAgentDefaults({ ...value.agentDefaults }), (saved) => saved);
      }
      // A hidden switch is null and cannot change.
      if (value.launchAtLogin !== null && previous.launchAtLogin !== value.launchAtLogin) {
        launchAtLoginChanged = true;
        persistField(
          "launchAtLogin",
          settingsPort().setAppBehaviorPreference({ launchAtLogin: value.launchAtLogin }),
          (preference) => preference.launchAtLogin,
        );
      }
      if (
        value.keepRunningInBackground !== null &&
        previous.keepRunningInBackground !== value.keepRunningInBackground
      ) {
        keepRunningInBackgroundChanged = true;
        persistField(
          "keepRunningInBackground",
          settingsPort().setAppBehaviorPreference({ keepRunningInBackground: value.keepRunningInBackground }),
          (preference) => preference.keepRunningInBackground,
        );
      }
      if (value.keepAwake !== null && previous.keepAwake !== value.keepAwake) {
        keepAwakeChanged = true;
        persistField(
          "keepAwake",
          settingsPort().setAppBehaviorPreference({ keepAwake: value.keepAwake }),
          (preference) => preference.keepAwake,
        );
      }
      if (value.keepAwakeOnBattery !== null && previous.keepAwakeOnBattery !== value.keepAwakeOnBattery) {
        keepAwakeOnBatteryChanged = true;
        persistField(
          "keepAwakeOnBattery",
          settingsPort().setAppBehaviorPreference({ keepAwakeOnBattery: value.keepAwakeOnBattery }),
          (preference) => preference.keepAwakeOnBattery,
        );
      }
      if (!sameExternalLinkTarget(previous.externalLinkTarget, value.externalLinkTarget)) {
        externalLinkTargetChanged = true;
        persistField(
          "externalLinkTarget",
          settingsPort().setExternalLinkPreference({ target: value.externalLinkTarget }),
          (preference) => preference.target,
        );
      }
      if (previous.keepRemoteSessions !== value.keepRemoteSessions) {
        keepRemoteSessionsChanged = true;
        persistField(
          "keepRemoteSessions",
          settingsPort().setRemoteSessionReusePreference({ keepBetweenRuns: value.keepRemoteSessions }),
          (preference) => preference.keepBetweenRuns,
        );
      }
      if (
        previous.macBookNotch !== value.macBookNotch ||
        previous.macBookNotchHaptics !== value.macBookNotchHaptics ||
        previous.macBookNotchIdle !== value.macBookNotchIdle ||
        previous.macBookNotchAdditionalDisplays !== value.macBookNotchAdditionalDisplays ||
        previous.macBookNotchWidthPercent !== value.macBookNotchWidthPercent ||
        previous.macBookNotchHeightPercent !== value.macBookNotchHeightPercent ||
        previous.macBookNotchServers !== value.macBookNotchServers ||
        previous.macBookNotchNewServers !== value.macBookNotchNewServers
      ) {
        // A slider drag sends one save per step. Only the reply to the newest save may change the
        // form, or an older reply would move the slider back while the user drags.
        const save = ++dynamicIslandSaveCount;
        void settingsPort()
          .dynamicIsland.setPreference({
            enabled: value.macBookNotch,
            hapticsEnabled: value.macBookNotchHaptics,
            idleVisible: value.macBookNotchIdle,
            additionalDisplaysEnabled: value.macBookNotchAdditionalDisplays,
            widthPercent: value.macBookNotchWidthPercent,
            heightPercent: value.macBookNotchHeightPercent,
            serverVisibility: value.macBookNotchServers,
            newServersVisible: value.macBookNotchNewServers,
          })
          .then((preference) => {
            if (save !== dynamicIslandSaveCount) return;
            setGeneralSettings((current) => ({
              ...current,
              macBookNotch: preference.enabled,
              macBookNotchHaptics: preference.hapticsEnabled,
              macBookNotchIdle: preference.idleVisible,
              macBookNotchAdditionalDisplays: preference.additionalDisplaysEnabled,
              macBookNotchWidthPercent: preference.widthPercent,
              macBookNotchHeightPercent: preference.heightPercent,
              macBookNotchServers: preference.serverVisibility,
              macBookNotchNewServers: preference.newServersVisible,
            }));
          })
          .catch((error: unknown) => {
            if (save !== dynamicIslandSaveCount) return;
            showSaveFailure(error);
            setGeneralSettings((current) => ({
              ...current,
              macBookNotch: previous.macBookNotch,
              macBookNotchHaptics: previous.macBookNotchHaptics,
              macBookNotchIdle: previous.macBookNotchIdle,
              macBookNotchAdditionalDisplays: previous.macBookNotchAdditionalDisplays,
              macBookNotchWidthPercent: previous.macBookNotchWidthPercent,
              macBookNotchHeightPercent: previous.macBookNotchHeightPercent,
              macBookNotchServers: previous.macBookNotchServers,
              macBookNotchNewServers: previous.macBookNotchNewServers,
            }));
          });
      }
    }

    /** Whether this agent acts without asking at Full access. */
    function agentAutoApproves(agentId: string): boolean {
      return agentAutoApprovalEnabled(approvalAutomation(), agentId);
    }

    /** Remembers what to focus when the dialog closes; the dialog itself restores it. */
    function openAppSettings(trigger?: HTMLElement | null, tab?: SettingsTab): void {
      const target = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      appSettingsRestoreTarget = target;
      setAppSettingsTab(tab);
      setAppSettingsOpen(true);
      setAppSettingsOpenRequest((count) => count + 1);
    }

    /**
     * Opens the Notifications tab, the one place where the user changes the level of a server and its
     * agents. With a server, the tab moves to the row of that server.
     */
    function openNotificationLevels(serverId?: string, trigger?: HTMLElement | null): void {
      if (serverId) setNotificationFocusRequest({ serverId, nonce: ++notificationFocusNonce });
      // The modal applies a tab when the requested tab changes, so a repeated request clears it first.
      setAppSettingsTab(undefined);
      flush();
      openAppSettings(trigger, "notifications");
    }

    /** Opens the Hosted servers tab with the delete confirmation of one server. */
    function openHostedServerDelete(serverId: string, trigger?: HTMLElement | null): void {
      setHostedServerDeleteRequest({ serverId, nonce: ++hostedServerDeleteNonce });
      openAppSettings(trigger, "hosted-servers");
    }

    onSettled(() => {
      // The native Preferences menu item sends the same request from main, so the shortcut below only
      // covers the window itself: both land here, and the dialog owns the open state either way.
      const handleSettingsShortcut = (event: KeyboardEvent) => {
        if (!isOpenSettingsShortcut(event)) return;
        event.preventDefault();
        openAppSettings(event.target instanceof HTMLElement ? event.target : null);
      };
      window.addEventListener("keydown", handleSettingsShortcut);
      const unsubscribe = settingsPort().onOpenSettings(() => openAppSettings());
      const unsubscribeUpdateSettings = settingsPort().onOpenUpdateSettings(() =>
        openAppSettings(undefined, "updates"),
      );
      // A remote owner or admin can change an agent's grant from a phone or the web client.
      const unsubscribeApprovals = settingsPort().onApprovalAutomation(setApprovalAutomation);
      // Main follows the account's analytics answer from another device.
      const unsubscribeAnalytics = settingsPort().onAnalyticsPreference(({ enabled }) => {
        setAnalyticsPreferenceLoaded(enabled);
        setGeneralSettings((current) => ({ ...current, productAnalytics: enabled }));
      });
      // An admin of a joined server can change how many memories each agent of this computer keeps.
      const unsubscribeMemoryLimit = settingsPort().onAgentMemoryLimitPreference(({ limit }) => {
        agentMemoryLimitChanged = true;
        setGeneralSettings((current) => ({ ...current, agentMemoryLimit: limit }));
      });
      // An admin of a joined server can change the update switches of this computer.
      const unsubscribeUpdates = settingsPort().update.onPreference((preference) => {
        autoDownloadUpdatesChanged = true;
        autoInstallUpdatesChanged = true;
        setGeneralSettings((current) => ({
          ...current,
          autoDownloadUpdates: preference.autoDownload,
          autoInstallUpdates: preference.autoInstall,
        }));
      });
      // A page can open from main with no click here, such as a sign-in page, so main sends the notice.
      const unsubscribeLinkFallback = settingsPort().onExternalLinkFallback(({ name }) => {
        const { t } = currentText();
        actionToast.warning(t("settings.externalLinks.fallback.title", { name }), {
          id: "external-link-fallback",
          description: t("settings.externalLinks.fallback.description"),
        });
      });
      return () => {
        window.removeEventListener("keydown", handleSettingsShortcut);
        unsubscribeLinkFallback();
        unsubscribe();
        unsubscribeUpdateSettings();
        unsubscribeApprovals();
        unsubscribeAnalytics();
        unsubscribeMemoryLimit();
        unsubscribeUpdates();
      };
    });

    /**
     * Reads the saved preferences. A failed read keeps the default value of its rows, and marks the
     * load as failed so that the settings page can show the error and read again.
     */
    function loadPreferences(): void {
      setPreferencesLoad("loading");
      void Promise.allSettled([
        settingsPort()
          .getAnalyticsPreference()
          .then(
            (preference) => {
              setAnalyticsPreferenceLoaded(preference.enabled);
              setGeneralSettings((current) => ({ ...current, productAnalytics: preference.enabled }));
            },
            (error: unknown) => {
              // Analytics stays off until a read or the user turns it on. A retry that fails again
              // keeps the value that is already shown.
              if (analyticsPreferenceLoaded() === null) {
                setAnalyticsPreferenceLoaded(false);
                setGeneralSettings((current) => ({ ...current, productAnalytics: false }));
              }
              throw error;
            },
          ),
        settingsPort()
          .update.getPreference()
          .then((preference) => {
            // A toggle made before this read resolves has already been persisted, so the older value
            // must not be painted back over it.
            setGeneralSettings((current) => ({
              ...current,
              autoDownloadUpdates: autoDownloadUpdatesChanged ? current.autoDownloadUpdates : preference.autoDownload,
              allowRemoteUpdates: allowRemoteUpdatesChanged
                ? current.allowRemoteUpdates
                : preference.allowRemoteUpdates,
              autoInstallUpdates: autoInstallUpdatesChanged ? current.autoInstallUpdates : preference.autoInstall,
            }));
          }),
        settingsPort()
          .getBusyMessageModePreference()
          .then((preference) => {
            if (busyMessageModeChanged) return;
            setGeneralSettings((current) => ({ ...current, busyMessageMode: preference.mode }));
          }),
        settingsPort()
          .getAgentDefaults()
          .then((defaults) => {
            if (agentDefaultsChanged) return;
            setGeneralSettings((current) => ({ ...current, agentDefaults: defaults }));
          }),
        settingsPort()
          .getAgentMemoryLimitPreference()
          .then((preference) => {
            if (agentMemoryLimitChanged) return;
            setGeneralSettings((current) => ({ ...current, agentMemoryLimit: preference.limit }));
          }),
        settingsPort()
          .getAppBehaviorPreference()
          .then((preference) => {
            setGeneralSettings((current) => ({
              ...current,
              launchAtLogin: launchAtLoginChanged ? current.launchAtLogin : preference.launchAtLogin,
              keepRunningInBackground: keepRunningInBackgroundChanged
                ? current.keepRunningInBackground
                : preference.keepRunningInBackground,
              keepAwake: keepAwakeChanged ? current.keepAwake : preference.keepAwake,
              keepAwakeOnBattery: keepAwakeOnBatteryChanged
                ? current.keepAwakeOnBattery
                : preference.keepAwakeOnBattery,
            }));
          }),
        settingsPort()
          .getExternalLinkPreference()
          .then((preference) => {
            if (externalLinkTargetChanged) return;
            setGeneralSettings((current) => ({ ...current, externalLinkTarget: preference.target }));
          }),
        settingsPort()
          .getRemoteSessionReusePreference()
          .then((preference) => {
            if (keepRemoteSessionsChanged) return;
            setGeneralSettings((current) => ({ ...current, keepRemoteSessions: preference.keepBetweenRuns }));
          }),
        settingsPort()
          .notifications.getPreference()
          .then((preference) => {
            if (notificationPreferenceChanged) return;
            setGeneralSettings((current) => ({
              ...current,
              desktopNotifications: preference.desktopNotifications,
              notificationPreview: preference.messagePreview,
            }));
          }),
        // Main accepts island calls only from the main window, which owns the island.
        platform.chatWindow
          ? Promise.resolve()
          : settingsPort()
              .dynamicIsland.getPreference()
              .then((preference) =>
                setGeneralSettings((current) => ({
                  ...current,
                  macBookNotch: preference.enabled,
                  macBookNotchHaptics: preference.hapticsEnabled,
                  macBookNotchIdle: preference.idleVisible,
                  macBookNotchAdditionalDisplays: preference.additionalDisplaysEnabled,
                  macBookNotchWidthPercent: preference.widthPercent,
                  macBookNotchHeightPercent: preference.heightPercent,
                  macBookNotchServers: preference.serverVisibility,
                  macBookNotchNewServers: preference.newServersVisible,
                })),
              ),
      ]).then((results) => {
        setPreferencesLoad(results.some((result) => result.status === "rejected") ? "failed" : "loaded");
      });
    }

    onSettled(() => {
      loadPreferences();
      void settingsPort()
        .getApprovalAutomation()
        .then(setApprovalAutomation)
        .catch(() => undefined);
      if (platform.chatWindow) return;
      void settingsPort()
        .dynamicIsland.getBuiltInDisplayGeometry()
        .then((geometry) => setBuiltInDisplayGeometry(geometry))
        .catch(() => undefined);
    });

    const sendTestNotification = () => settingsPort().notifications.test();
    const openNotificationSettings = () => settingsPort().notifications.openSettings();

    return {
      analyticsPreferenceLoaded,
      preferencesLoadFailed: () => preferencesLoad() === "failed",
      reloadPreferences: loadPreferences,
      generalSettings,
      builtInDisplayGeometry,
      updateGeneralSettings,
      sendTestNotification,
      openNotificationSettings,
      agentAutoApproves,
      appSettingsOpen,
      setAppSettingsOpen,
      appSettingsOpenRequest,
      appSettingsRestoreTarget: () => appSettingsRestoreTarget,
      appSettingsTab,
      openAppSettings,
      notificationFocusRequest,
      openNotificationLevels,
      hostedServerDeleteRequest,
      openHostedServerDelete,
      skillsMarketplaceOpen,
      setSkillsMarketplaceOpen,
      pendingPluginSlug,
      setPendingPluginSlug,
      pendingPluginConnect,
      setPendingPluginConnect,
      pendingAgentTemplateId,
      setPendingAgentTemplateId,
    };
  },
});

export const SettingsProvider = Settings.provider;
export const useSettings = Settings.use;
