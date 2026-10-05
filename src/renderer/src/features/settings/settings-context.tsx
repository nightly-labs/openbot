import {
  type ApprovalAutomationPreference,
  agentAutoApprovalEnabled,
  type DynamicIslandGeometry,
} from "@openbot/contracts/ipc";
import { DEFAULT_GENERAL_SETTINGS, type GeneralSettingsValue } from "@openbot/ui/features/settings/app-settings";
import { currentText } from "@openbot/ui/text";
import { createEffect, createSignal, onSettled } from "solid-js";
import { isActionSoundEnabled, readActionSoundTheme, setActionSoundChoice } from "../../action-sounds";
import { actionToast } from "../../action-toast";
import { desktopAnalytics } from "../../analytics";
import { isCompletionSoundEnabled, setCompletionSoundEnabled } from "../../completion-sound";
import { usePlatform } from "../../platform";
import { readSendShortcutMode, setSendShortcutMode, useSendShortcutMode } from "../../send-shortcut-preference";
import { createSimpleContext } from "../../simple-context";
import { useAuth } from "../account/account-context";
import { useSetup } from "../onboarding/onboarding-context";
import { settingsPort } from "./settings-port";
import { isOpenSettingsShortcut } from "./settings-shortcut";
import type { SettingsTab } from "./settings-tabs";

const ANALYTICS_APP_VERSION_STORAGE_KEY = "openbot:analytics-app-version";

/**
 * Application-wide preferences and the two surfaces that edit them: the
 * settings dialog and the skills marketplace.
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
    /** The tab that the next opening shows. Undefined keeps the tab that was open last. */
    const [appSettingsTab, setAppSettingsTab] = createSignal<SettingsTab | undefined>();
    const [generalSettings, setGeneralSettings] = createSignal<GeneralSettingsValue>({
      ...DEFAULT_GENERAL_SETTINGS,
      taskCompletionSound: isCompletionSoundEnabled(),
      sendShortcut: readSendShortcutMode(),
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
    const [approvalAutomation, setApprovalAutomation] = createSignal<ApprovalAutomationPreference>({
      turbo: false,
      defaultAutoApprove: false,
      autoApproveOverrides: {},
    });
    let appSettingsRestoreTarget: HTMLElement | null = null;
    let analyticsOpened = false;
    let analyticsVersionRecorded = false;
    let autoDownloadUpdatesChanged = false;
    let allowRemoteUpdatesChanged = false;
    let autoInstallUpdatesChanged = false;
    let desktopNotificationsChanged = false;
    let turboModeChanged = false;
    const [turboModePending, setTurboModePending] = createSignal(false);

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
        if (analyticsOpened) return;
        analyticsOpened = true;
        desktopAnalytics.track("desktop_app_opened", {
          setup_completed: setup.completed,
          signed_in: auth.status === "signed_in",
        });
      },
    );

    let dynamicIslandSaveCount = 0;

    function updateGeneralSettings(value: GeneralSettingsValue): void {
      const previous = generalSettings();
      const turboMode = turboModePending() ? previous.turboMode : value.turboMode;
      setGeneralSettings({ ...value, turboMode });
      if (previous.taskCompletionSound !== value.taskCompletionSound) {
        setCompletionSoundEnabled(value.taskCompletionSound);
      }
      if (previous.sendShortcut !== value.sendShortcut) {
        setSendShortcutMode(value.sendShortcut);
      }
      if (previous.soundFeedback !== value.soundFeedback || previous.soundTheme !== value.soundTheme) {
        setActionSoundChoice(value.soundFeedback ? value.soundTheme : "off");
      }
      if (previous.productAnalytics !== value.productAnalytics) {
        desktopAnalytics.setTrackingEnabled(value.productAnalytics);
        setAnalyticsPreferenceLoaded(value.productAnalytics);
        void settingsPort()
          .setAnalyticsPreference({ enabled: value.productAnalytics })
          .then((preference) => {
            desktopAnalytics.setTrackingEnabled(preference.enabled);
            setAnalyticsPreferenceLoaded(preference.enabled);
            setGeneralSettings((current) => ({ ...current, productAnalytics: preference.enabled }));
          })
          .catch(() => {
            desktopAnalytics.setTrackingEnabled(previous.productAnalytics);
            setAnalyticsPreferenceLoaded(previous.productAnalytics);
            setGeneralSettings((current) => ({ ...current, productAnalytics: previous.productAnalytics }));
          });
      }
      if (previous.turboMode !== turboMode) {
        turboModeChanged = true;
        setTurboModePending(true);
        void settingsPort()
          .setApprovalAutomation({ turbo: turboMode })
          .then((preference) => {
            setGeneralSettings((current) => ({ ...current, turboMode: preference.turbo }));
            setApprovalAutomation(preference);
          })
          .catch(() => {
            setGeneralSettings((current) => ({ ...current, turboMode: previous.turboMode }));
            const { t } = currentText();
            actionToast.error(
              previous.turboMode ? t("settings.turbo.turnOffFailed") : t("settings.turbo.turnOnFailed"),
            );
          })
          .finally(() => setTurboModePending(false));
      }
      if (previous.autoDownloadUpdates !== value.autoDownloadUpdates) {
        autoDownloadUpdatesChanged = true;
        void settingsPort()
          .update.setPreference({ autoDownload: value.autoDownloadUpdates })
          .then((preference) =>
            setGeneralSettings((current) => ({ ...current, autoDownloadUpdates: preference.autoDownload })),
          )
          .catch(() =>
            setGeneralSettings((current) => ({ ...current, autoDownloadUpdates: previous.autoDownloadUpdates })),
          );
      }
      if (previous.allowRemoteUpdates !== value.allowRemoteUpdates) {
        allowRemoteUpdatesChanged = true;
        void settingsPort()
          .update.setPreference({ allowRemoteUpdates: value.allowRemoteUpdates })
          .then((preference) =>
            setGeneralSettings((current) => ({ ...current, allowRemoteUpdates: preference.allowRemoteUpdates })),
          )
          .catch(() =>
            setGeneralSettings((current) => ({ ...current, allowRemoteUpdates: previous.allowRemoteUpdates })),
          );
      }
      if (previous.autoInstallUpdates !== value.autoInstallUpdates) {
        autoInstallUpdatesChanged = true;
        void settingsPort()
          .update.setPreference({ autoInstall: value.autoInstallUpdates })
          .then((preference) =>
            setGeneralSettings((current) => ({ ...current, autoInstallUpdates: preference.autoInstall })),
          )
          .catch(() =>
            setGeneralSettings((current) => ({ ...current, autoInstallUpdates: previous.autoInstallUpdates })),
          );
      }
      if (previous.desktopNotifications !== value.desktopNotifications) {
        desktopNotificationsChanged = true;
        void settingsPort()
          .notifications.setPreference({ desktopNotifications: value.desktopNotifications })
          .then((preference) =>
            setGeneralSettings((current) => ({ ...current, desktopNotifications: preference.desktopNotifications })),
          )
          .catch(() =>
            setGeneralSettings((current) => ({ ...current, desktopNotifications: previous.desktopNotifications })),
          );
      }
      if (
        previous.macBookNotch !== value.macBookNotch ||
        previous.macBookNotchHaptics !== value.macBookNotchHaptics ||
        previous.macBookNotchIdle !== value.macBookNotchIdle ||
        previous.macBookNotchAdditionalDisplays !== value.macBookNotchAdditionalDisplays ||
        previous.macBookNotchWidthPercent !== value.macBookNotchWidthPercent ||
        previous.macBookNotchHeightPercent !== value.macBookNotchHeightPercent
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
            }));
          })
          .catch(() => {
            if (save !== dynamicIslandSaveCount) return;
            setGeneralSettings((current) => ({
              ...current,
              macBookNotch: previous.macBookNotch,
              macBookNotchHaptics: previous.macBookNotchHaptics,
              macBookNotchIdle: previous.macBookNotchIdle,
              macBookNotchAdditionalDisplays: previous.macBookNotchAdditionalDisplays,
              macBookNotchWidthPercent: previous.macBookNotchWidthPercent,
              macBookNotchHeightPercent: previous.macBookNotchHeightPercent,
            }));
          });
      }
    }

    /**
     * Grants or revokes one agent's standing approval.
     *
     * Not part of `updateGeneralSettings`: the grant is per agent rather than a field of the one
     * settings record, and it is written from the approval card as well as from Settings. The
     * promise is returned so the approval card only accepts the pending request once the grant is
     * stored - accepting first would leave an agent the user believes is trusted still asking.
     */
    async function setAgentAutoApprove(agentId: string, autoApprove: boolean): Promise<void> {
      const preference = await settingsPort().setApprovalAutomation({ agentId, autoApprove });
      setApprovalAutomation(preference);
      setGeneralSettings((current) => ({ ...current, turboMode: preference.turbo }));
    }

    /** Whether this agent acts without asking, by its own grant or because Turbo covers every agent. */
    function agentAutoApproves(agentId: string): boolean {
      return agentAutoApprovalEnabled({ ...approvalAutomation(), turbo: generalSettings().turboMode }, agentId);
    }

    /** Remembers what to focus when the dialog closes; the dialog itself restores it. */
    function openAppSettings(trigger?: HTMLElement | null, tab?: SettingsTab): void {
      const target = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      appSettingsRestoreTarget = target;
      setAppSettingsTab(tab);
      setAppSettingsOpen(true);
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
      // A remote owner or admin can change an agent's grant from a phone or the web client.
      const unsubscribeApprovals = settingsPort().onApprovalAutomation(setApprovalAutomation);
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
      return () => {
        window.removeEventListener("keydown", handleSettingsShortcut);
        unsubscribe();
        unsubscribeApprovals();
        unsubscribeUpdates();
      };
    });

    onSettled(() => {
      void settingsPort()
        .getAnalyticsPreference()
        .then((preference) => {
          setAnalyticsPreferenceLoaded(preference.enabled);
          setGeneralSettings((current) => ({ ...current, productAnalytics: preference.enabled }));
        })
        .catch(() => {
          setAnalyticsPreferenceLoaded(false);
          setGeneralSettings((current) => ({ ...current, productAnalytics: false }));
        });
      void settingsPort()
        .getApprovalAutomation()
        .then((preference) => {
          setApprovalAutomation(preference);
          // A toggle made before this read resolves has already been persisted, so the older value
          // must not be painted back over it.
          if (turboModeChanged) return;
          setGeneralSettings((current) => ({ ...current, turboMode: preference.turbo }));
        })
        .catch(() => undefined);
      void settingsPort()
        .update.getPreference()
        .then((preference) => {
          // A toggle made before this read resolves has already been persisted, so the older value
          // must not be painted back over it.
          setGeneralSettings((current) => ({
            ...current,
            autoDownloadUpdates: autoDownloadUpdatesChanged ? current.autoDownloadUpdates : preference.autoDownload,
            allowRemoteUpdates: allowRemoteUpdatesChanged ? current.allowRemoteUpdates : preference.allowRemoteUpdates,
            autoInstallUpdates: autoInstallUpdatesChanged ? current.autoInstallUpdates : preference.autoInstall,
          }));
        })
        .catch(() => undefined);
      void settingsPort()
        .notifications.getPreference()
        .then((preference) => {
          if (desktopNotificationsChanged) return;
          setGeneralSettings((current) => ({ ...current, desktopNotifications: preference.desktopNotifications }));
        })
        .catch(() => undefined);
      void settingsPort()
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
          })),
        )
        .catch(() => undefined);
      void settingsPort()
        .dynamicIsland.getBuiltInDisplayGeometry()
        .then((geometry) => setBuiltInDisplayGeometry(geometry))
        .catch(() => undefined);
    });

    const sendTestNotification = () => settingsPort().notifications.test();
    const openNotificationSettings = () => settingsPort().notifications.openSettings();

    return {
      analyticsPreferenceLoaded,
      generalSettings,
      builtInDisplayGeometry,
      turboModePending,
      updateGeneralSettings,
      sendTestNotification,
      openNotificationSettings,
      setAgentAutoApprove,
      agentAutoApproves,
      appSettingsOpen,
      setAppSettingsOpen,
      appSettingsRestoreTarget: () => appSettingsRestoreTarget,
      appSettingsTab,
      openAppSettings,
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
