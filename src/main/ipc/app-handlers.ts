// App identity, first-run setup, the analytics preference, external links and the data and
// diagnostics exports.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AppInfo, AppSetupState, AppVariant, ExternalDestination } from "@openbot/contracts/ipc";
import { app, type BrowserWindow, shell } from "electron";
import type { AgentService } from "../../backend/agent-service";
import type { BrowserHost } from "../../backend/browser-host";
import type { MailboxStore } from "../../backend/mailbox-store";
import { readAnalyticsPreference, writeAnalyticsPreference } from "../analytics-preference-store";
import type { ApprovalAutomation } from "../approval-automation-store";
import type { LanguageService } from "../language-service";
import { MAC_PERMISSION_URLS } from "../mac-permission-urls";
import { exportDiagnostics, exportOpenBotData } from "../maintenance-service";
import { readSetupState, writeSetupState } from "../setup-store";
import type { UpdateService } from "../update-service";
import {
  parseAnalyticsPreference,
  parseAppLanguagePreference,
  parseApprovalAutomation,
  parseExternalDestination,
  parseSetup,
} from "./app-inputs";
import { stringPayload } from "./validation";

/**
 * Every destination `openExternal` may reach, as a closed table.
 *
 * Exported because the addresses are a product contract the checker cannot judge: a wrong one sends
 * a user who asked for an OpenCode Go key to some other site, and the type only says "a string".
 *
 * `mac-screen-recording` is the one entry that is not a web page. macOS opens a settings pane from a
 * URL, and the table is what keeps that address out of the renderer. It is the same pane the
 * Computer Use panel opens, so it is read from `mac-permission-urls.ts` rather than written twice.
 */
export const EXTERNAL_DESTINATIONS: Record<ExternalDestination, string> = {
  "agent-setup": "https://github.com/nightly-labs/openbot/blob/main/docs/TROUBLESHOOTING.md",
  "opencode-install": "https://opencode.ai/docs/",
  "opencode-auth": "https://opencode.ai/auth",
  "claude-install": "https://code.claude.com/docs",
  feedback: "https://x.com/intent/post?text=Feedback%20for%20OpenBot%20%40norbertbodziony%3A%20",
  message: "https://x.com/norbertbodziony",
  "grok-bot-export": "https://x.ai/bot/jj5KlgQtJtskec5vhDUjr",
  "mac-screen-recording": MAC_PERMISSION_URLS["screen-recording"],
};

import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export interface AppIpcDependencies {
  service: AgentService;
  mailbox: MailboxStore;
  browser: BrowserHost;
  updater: UpdateService;
  setupFile: string;
  analyticsPreferenceFile: string;
  approvalAutomation: ApprovalAutomation;
  language: LanguageService;
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
  approvalAutomation,
  language,
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
      getApprovalAutomation: handler(() => approvalAutomation.current()),
      setApprovalAutomation: payloadHandler(parseApprovalAutomation, (parsed) => approvalAutomation.set(parsed)),
      getAppLanguagePreference: handler(() => language.preference),
      setAppLanguagePreference: payloadHandler(parseAppLanguagePreference, (parsed) => language.set(parsed)),
      saveSetup: payloadHandler(parseSetup, async (input): Promise<AppSetupState> => {
        const state = await writeSetupState(setupFile, input);
        await service.setPreferredProvider(input.preferredProvider, input.preferredModel);
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
