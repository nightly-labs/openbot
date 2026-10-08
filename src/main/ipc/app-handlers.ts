import { Effect, Semaphore } from "effect";
// App identity, first-run setup, the analytics preference, external links and the data and
// diagnostics exports.

import { HOSTED_SERVER_CONTACT_URL } from "@openbot/contracts/hosted-servers";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AppInfo,
  type AppSetupState,
  type AppVariant,
  type ExternalDestination,
  GROK_BOT_EXPORT_URL,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { app, type BrowserWindow, shell } from "electron";
import type { AgentService } from "../../backend/agent-service";
import type { BrowserHost } from "../../backend/browser-host";
import type { MailboxStore } from "../../backend/mailbox-store";
import { readAnalyticsPreference, writeAnalyticsPreference } from "../analytics-preference-store";
import type { ApprovalAutomation } from "../approval-automation-store";
import type { BusyMessageModePreferenceStore } from "../busy-message-mode-preference-store";
import type { LanguageService } from "../language-service";
import type { LogoColorService } from "../logo-color-service";
import { MAC_PERMISSION_URLS } from "../mac-permission-urls";
import { exportDiagnostics, exportOpenBotData } from "../maintenance-service";
import type { RemoteSessionCache } from "../remote-session-cache";
import type { RemoteSessionReusePreferenceStore } from "../remote-session-reuse-preference-store";
import { readSetupState, writeSetupState } from "../setup-store";
import type { UpdateService } from "../update-service";
import {
  parseAnalyticsPreference,
  parseAppLanguagePreference,
  parseAppLogoColorPreference,
  parseApprovalAutomation,
  parseBusyMessageModePreference,
  parseExternalDestination,
  parseRemoteSessionReusePreference,
  parseSetup,
} from "./app-inputs";
import { stringPayload } from "./validation";

/**
 * Every destination `openExternal` may reach, as a closed table.
 *
 * Exported because the addresses are a product contract the checker cannot judge: a wrong one sends
 * a user who asked for an OpenCode Go key to some other site, and the type only says "a string".
 *
 * `mac-screen-recording` is not a web page. macOS opens a settings pane from a URL, and the table is
 * what keeps that address out of the renderer. It is the same pane the Computer Use panel opens, so
 * it is read from `mac-permission-urls.ts` rather than written twice. `hosted-server-contact` is a
 * `mailto:` address, which `openUrl` refuses; the web client opens the same constant.
 */
export const EXTERNAL_DESTINATIONS: Record<ExternalDestination, string> = {
  "agent-setup": "https://github.com/nightly-labs/openbot/blob/main/docs/TROUBLESHOOTING.md",
  "opencode-install": "https://opencode.ai/docs/",
  "opencode-auth": "https://opencode.ai/auth",
  "claude-install": "https://code.claude.com/docs",
  feedback: "https://x.com/intent/post?text=Feedback%20for%20OpenBot%20%40norbertbodziony%3A%20",
  message: "https://x.com/norbertbodziony",
  "grok-bot-export": GROK_BOT_EXPORT_URL,
  "hosted-server-contact": HOSTED_SERVER_CONTACT_URL,
  "mac-screen-recording": MAC_PERMISSION_URLS["screen-recording"],
  "tailscale-download": "https://tailscale.com/download",
  "tailscale-windows-download": "https://tailscale.com/download/windows",
  "tailscale-admin-dns": "https://login.tailscale.com/admin/dns",
  "tailscale-admin-machines": "https://login.tailscale.com/admin/machines",
  "tailscale-sharing": "https://tailscale.com/kb/1084/sharing",
};

import { runCauseEffect } from "../../backend/effect-boundary";
import type { TraceFile } from "../trace-file";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export interface AppIpcDependencies {
  service: AgentService;
  mailbox: MailboxStore;
  browser: BrowserHost;
  updater: UpdateService;
  setupFile: string;
  analyticsPreferenceFile: string;
  approvalAutomation: ApprovalAutomation;
  busyMessageMode: BusyMessageModePreferenceStore;
  remoteSessionReuse: RemoteSessionReusePreferenceStore;
  remoteSessionCache: RemoteSessionCache;
  language: LanguageService;
  logoColor: LogoColorService;
  initializeAgent: () => Promise<void>;
  appVariant: AppVariant;
  getMainWindow: () => BrowserWindow | null;
  setAnalyticsTrackingEnabled: (enabled: boolean) => void;
  trace: TraceFile;
}

export function appIpcHandlers({
  service,
  mailbox,
  browser,
  updater,
  setupFile,
  analyticsPreferenceFile,
  approvalAutomation,
  busyMessageMode,
  remoteSessionReuse,
  remoteSessionCache,
  language,
  logoColor,
  initializeAgent,
  appVariant,
  getMainWindow,
  setAnalyticsTrackingEnabled,
  trace,
}: AppIpcDependencies): Pick<IpcGroupHandlers, "app" | "maintenance"> {
  // One write at a time, so two quick toggles leave the file and the tracker at the last choice.
  const analyticsPreferenceWrites = Semaphore.makeUnsafe(1);
  return {
    app: {
      getAppInfo: handler((): AppInfo => {
        const platform = process.platform;
        if (platform !== "darwin" && platform !== "win32" && platform !== "linux") {
          throw new Error(`Unsupported desktop platform: ${platform}`);
        }
        return { name: app.getName(), version: app.getVersion(), platform, variant: appVariant };
      }),
      getSetupState: handler(() => runCauseEffect(readSetupState(setupFile))),
      getAnalyticsPreference: handler(() => Effect.runPromise(readAnalyticsPreference(analyticsPreferenceFile))),
      setAnalyticsPreference: payloadHandler(parseAnalyticsPreference, (parsed) => {
        return runCauseEffect(
          analyticsPreferenceWrites.withPermit(
            writeAnalyticsPreference(analyticsPreferenceFile, parsed.enabled).pipe(
              Effect.tap((preference) => Effect.sync(() => setAnalyticsTrackingEnabled(preference.enabled))),
              Effect.uninterruptible,
            ),
          ),
        );
      }),
      getApprovalAutomation: handler(() => approvalAutomation.current()),
      setApprovalAutomation: payloadHandler(parseApprovalAutomation, (parsed) =>
        runCauseEffect(approvalAutomation.set(parsed)),
      ),
      getBusyMessageModePreference: handler(() => busyMessageMode.get()),
      setBusyMessageModePreference: payloadHandler(parseBusyMessageModePreference, (parsed) =>
        runCauseEffect(busyMessageMode.set(parsed)),
      ),
      getRemoteSessionReusePreference: handler(() => remoteSessionReuse.get()),
      // Off removes the kept sessions at once. The sessions of this run then end when the app quits.
      setRemoteSessionReusePreference: payloadHandler(parseRemoteSessionReusePreference, async (parsed) => {
        const saved = await runCauseEffect(remoteSessionReuse.set(parsed));
        await Effect.runPromise(remoteSessionCache.setEnabled(saved.keepBetweenRuns));
        return saved;
      }),
      getAppLanguagePreference: handler(() => language.preference),
      setAppLanguagePreference: payloadHandler(parseAppLanguagePreference, (parsed) =>
        runCauseEffect(language.set(parsed)),
      ),
      getAppLogoColorPreference: handler(() => logoColor.preference),
      setAppLogoColorPreference: payloadHandler(parseAppLogoColorPreference, (parsed) =>
        runCauseEffect(logoColor.set(parsed)),
      ),
      saveSetup: payloadHandler(parseSetup, async (input): Promise<AppSetupState> => {
        const state = await runCauseEffect(writeSetupState(setupFile, input));
        await runCauseEffect(service.setPreferredProvider(input.preferredProvider, input.preferredModel));
        await initializeAgent();
        return state;
      }),
      openExternal: payloadHandler(parseExternalDestination, (parsed) => {
        return shell.openExternal(EXTERNAL_DESTINATIONS[parsed]);
      }),
      openUrl: payloadHandler(stringPayload("URL", INPUT_LIMITS.browserUrl), (url) => {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new Error(sourceText("error.app.externalLinkProtocol"));
        }
        return shell.openExternal(parsed.toString());
      }),
    },
    maintenance: {
      exportData: handler(() =>
        runCauseEffect(
          exportOpenBotData({ service, mailbox, parentWindow: getMainWindow(), translate: language.translate }),
        ),
      ),
      exportDiagnostics: handler(() =>
        runCauseEffect(
          exportDiagnostics({
            service,
            browser,
            updater,
            trace,
            parentWindow: getMainWindow(),
            translate: language.translate,
          }),
        ),
      ),
    },
  };
}
