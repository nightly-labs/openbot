// App identity, first-run setup, the analytics preference, external links and the data and
// diagnostics exports.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AppInfo, AppSetupState, AppVariant, ExternalDestination } from "@openbot/contracts/ipc";
import { app, type BrowserWindow, shell } from "electron";
import type { AgentService } from "../../backend/agent-service";
import type { BrowserHost } from "../../backend/browser-host";
import type { MailboxStore } from "../../backend/mailbox-store";
import { readAnalyticsPreference, writeAnalyticsPreference } from "../analytics-preference-store";
import { exportDiagnostics, exportOpenBotData } from "../maintenance-service";
import { readSetupState, writeSetupState } from "../setup-store";
import type { UpdateService } from "../update-service";
import { parseAnalyticsPreference, parseExternalDestination, parseProvider } from "./app-inputs";
import { stringPayload } from "./validation";

const EXTERNAL_DESTINATIONS: Record<ExternalDestination, string> = {
  "agent-setup": "https://github.com/NorbertBodziony/openbot/blob/main/docs/TROUBLESHOOTING.md",
  "claude-install": "https://code.claude.com/docs",
  "claude-sign-in": "https://code.claude.com/docs/en/authentication",
  feedback: "https://x.com/intent/post?text=Feedback%20for%20OpenBot%20%40norbertbodziony%3A%20",
  message: "https://x.com/norbertbodziony",
};

import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export interface AppIpcDependencies {
  service: AgentService;
  mailbox: MailboxStore;
  browser: BrowserHost;
  updater: UpdateService;
  setupFile: string;
  analyticsPreferenceFile: string;
  initializeAgent: () => Promise<void>;
  appVariant: AppVariant;
  getMainWindow: () => BrowserWindow | null;
  setAnalyticsTrackingEnabled: (enabled: boolean) => void;
}

export function appIpcHandlers({
  service,
  mailbox,
  browser,
  updater,
  setupFile,
  analyticsPreferenceFile,
  initializeAgent,
  appVariant,
  getMainWindow,
  setAnalyticsTrackingEnabled,
}: AppIpcDependencies): Pick<IpcGroupHandlers, "app" | "maintenance"> {
  return {
    app: {
      getAppInfo: handler((): AppInfo => {
        const platform = process.platform;
        if (platform !== "darwin" && platform !== "win32" && platform !== "linux") {
          throw new Error(`Unsupported desktop platform: ${platform}`);
        }
        return { name: app.getName(), version: app.getVersion(), platform, variant: appVariant };
      }),
      getSetupState: handler(() => readSetupState(setupFile)),
      getAnalyticsPreference: handler(() => readAnalyticsPreference(analyticsPreferenceFile)),
      setAnalyticsPreference: payloadHandler(parseAnalyticsPreference, async (parsed) => {
        const preference = await writeAnalyticsPreference(analyticsPreferenceFile, parsed.enabled);
        setAnalyticsTrackingEnabled(preference.enabled);
        return preference;
      }),
      saveSetup: payloadHandler(parseProvider, async (preferredProvider): Promise<AppSetupState> => {
        const state = await writeSetupState(setupFile, preferredProvider);
        await service.setPreferredProvider(preferredProvider);
        await initializeAgent();
        return state;
      }),
      openExternal: payloadHandler(parseExternalDestination, (parsed) => {
        return shell.openExternal(EXTERNAL_DESTINATIONS[parsed]);
      }),
      openUrl: payloadHandler(stringPayload("URL", INPUT_LIMITS.browserUrl), (url) => {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new Error("Only HTTP(S) links can open in the external browser.");
        }
        return shell.openExternal(parsed.toString());
      }),
    },
    maintenance: {
      exportData: handler(() => exportOpenBotData({ service, mailbox, parentWindow: getMainWindow() })),
      exportDiagnostics: handler(() => exportDiagnostics({ service, browser, updater, parentWindow: getMainWindow() })),
    },
  };
}
