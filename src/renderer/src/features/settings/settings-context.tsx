import { type ApprovalAutomationPreference, agentAutoApprovalEnabled } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import { DEFAULT_GENERAL_SETTINGS, type GeneralSettingsValue } from "@openbot/ui/features/settings/app-settings";
import { createEffect, createSignal, onSettled } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { usePlatform } from "../../platform";
import { createSimpleContext } from "../../simple-context";
import { useAuth } from "../account/account-context";
import { useSetup } from "../onboarding/onboarding-context";
import { isOpenSettingsShortcut } from "./settings-shortcut";

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
    /**
     * The plugin an `openbot://plugins/<slug>` link asked for, held beside the open flag because the
     * marketplace is loaded lazily: the slug has to outlive the chunk load that shows it. It is a
     * slug and never a listing, so the link cannot describe what the user is about to install.
     */
    const [pendingPluginSlug, setPendingPluginSlug] = createSignal<string | null>(null);
    const [appSettingsOpen, setAppSettingsOpen] = createSignal(false);
    const [generalSettings, setGeneralSettings] = createSignal<GeneralSettingsValue>(DEFAULT_GENERAL_SETTINGS);
    const [approvalAutomation, setApprovalAutomation] = createSignal<ApprovalAutomationPreference>({
      turbo: false,
      defaultAutoApprove: false,
      autoApproveOverrides: {},
    });
    let appSettingsRestoreTarget: HTMLElement | null = null;
    let analyticsOpened = false;
    let analyticsVersionRecorded = false;
    let autoDownloadUpdatesChanged = false;
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

    function updateGeneralSettings(value: GeneralSettingsValue): void {
      const previous = generalSettings();
      const turboMode = turboModePending() ? previous.turboMode : value.turboMode;
      setGeneralSettings({ ...value, turboMode });
      if (previous.productAnalytics !== value.productAnalytics) {
        desktopAnalytics.setTrackingEnabled(value.productAnalytics);
        setAnalyticsPreferenceLoaded(value.productAnalytics);
        void window.openbot
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
        void window.openbot
          .setApprovalAutomation({ turbo: turboMode })
          .then((preference) => {
            setGeneralSettings((current) => ({ ...current, turboMode: preference.turbo }));
            setApprovalAutomation(preference);
          })
          .catch(() => {
            setGeneralSettings((current) => ({ ...current, turboMode: previous.turboMode }));
            toast.error(
              previous.turboMode
                ? "Could not turn off Turbo mode. It is still active. Try again."
                : "Could not turn on Turbo mode. Try again.",
            );
          })
          .finally(() => setTurboModePending(false));
      }
      if (previous.autoDownloadUpdates !== value.autoDownloadUpdates) {
        autoDownloadUpdatesChanged = true;
        void window.openbot.update
          .setPreference({ autoDownload: value.autoDownloadUpdates })
          .then((preference) =>
            setGeneralSettings((current) => ({ ...current, autoDownloadUpdates: preference.autoDownload })),
          )
          .catch(() =>
            setGeneralSettings((current) => ({ ...current, autoDownloadUpdates: previous.autoDownloadUpdates })),
          );
      }
      if (
        previous.macBookNotch !== value.macBookNotch ||
        previous.macBookNotchHaptics !== value.macBookNotchHaptics ||
        previous.macBookNotchIdle !== value.macBookNotchIdle ||
        previous.macBookNotchAdditionalDisplays !== value.macBookNotchAdditionalDisplays
      ) {
        void window.openbot.dynamicIsland
          .setPreference({
            enabled: value.macBookNotch,
            hapticsEnabled: value.macBookNotchHaptics,
            idleVisible: value.macBookNotchIdle,
            additionalDisplaysEnabled: value.macBookNotchAdditionalDisplays,
          })
          .then((preference) =>
            setGeneralSettings((current) => ({
              ...current,
              macBookNotch: preference.enabled,
              macBookNotchHaptics: preference.hapticsEnabled,
              macBookNotchIdle: preference.idleVisible,
              macBookNotchAdditionalDisplays: preference.additionalDisplaysEnabled,
            })),
          )
          .catch(() =>
            setGeneralSettings((current) => ({
              ...current,
              macBookNotch: previous.macBookNotch,
              macBookNotchHaptics: previous.macBookNotchHaptics,
              macBookNotchIdle: previous.macBookNotchIdle,
              macBookNotchAdditionalDisplays: previous.macBookNotchAdditionalDisplays,
            })),
          );
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
      const preference = await window.openbot.setApprovalAutomation({ agentId, autoApprove });
      setApprovalAutomation(preference);
      setGeneralSettings((current) => ({ ...current, turboMode: preference.turbo }));
    }

    /** Whether this agent acts without asking, by its own grant or because Turbo covers every agent. */
    function agentAutoApproves(agentId: string): boolean {
      return agentAutoApprovalEnabled({ ...approvalAutomation(), turbo: generalSettings().turboMode }, agentId);
    }

    /** Remembers what to focus when the dialog closes; the dialog itself restores it. */
    function openAppSettings(trigger?: HTMLElement | null): void {
      const target = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      appSettingsRestoreTarget = target;
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
      const unsubscribe = window.openbot.onOpenSettings(() => openAppSettings());
      return () => {
        window.removeEventListener("keydown", handleSettingsShortcut);
        unsubscribe();
      };
    });

    onSettled(() => {
      void window.openbot
        .getAnalyticsPreference()
        .then((preference) => {
          setAnalyticsPreferenceLoaded(preference.enabled);
          setGeneralSettings((current) => ({ ...current, productAnalytics: preference.enabled }));
        })
        .catch(() => {
          setAnalyticsPreferenceLoaded(false);
          setGeneralSettings((current) => ({ ...current, productAnalytics: false }));
        });
      void window.openbot
        .getApprovalAutomation()
        .then((preference) => {
          setApprovalAutomation(preference);
          // A toggle made before this read resolves has already been persisted, so the older value
          // must not be painted back over it.
          if (turboModeChanged) return;
          setGeneralSettings((current) => ({ ...current, turboMode: preference.turbo }));
        })
        .catch(() => undefined);
      void window.openbot.update
        .getPreference()
        .then((preference) => {
          // A toggle made before this read resolves has already been persisted, so the older value
          // must not be painted back over it.
          if (autoDownloadUpdatesChanged) return;
          setGeneralSettings((current) => ({ ...current, autoDownloadUpdates: preference.autoDownload }));
        })
        .catch(() => undefined);
      void window.openbot.dynamicIsland
        .getPreference()
        .then((preference) =>
          setGeneralSettings((current) => ({
            ...current,
            macBookNotch: preference.enabled,
            macBookNotchHaptics: preference.hapticsEnabled,
            macBookNotchIdle: preference.idleVisible,
            macBookNotchAdditionalDisplays: preference.additionalDisplaysEnabled,
          })),
        )
        .catch(() => undefined);
    });

    return {
      analyticsPreferenceLoaded,
      generalSettings,
      turboModePending,
      updateGeneralSettings,
      setAgentAutoApprove,
      agentAutoApproves,
      appSettingsOpen,
      setAppSettingsOpen,
      appSettingsRestoreTarget: () => appSettingsRestoreTarget,
      openAppSettings,
      skillsMarketplaceOpen,
      setSkillsMarketplaceOpen,
      pendingPluginSlug,
      setPendingPluginSlug,
    };
  },
});

export const SettingsProvider = Settings.provider;
export const useSettings = Settings.use;
