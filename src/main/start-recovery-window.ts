// The window that shows before the start when one version did not finish its start several times
// in a row (`start-attempts.ts`). It must work when the normal start does not: it has no preload, no
// IPC, no renderer bundle and no database. The main process writes the page as a `data:` URL, and
// its buttons are links to fixed URLs that the main process stops and handles.
import type { AppTranslate, TranslatedLocale } from "@openbot/i18n";
import { localeDirection } from "@openbot/i18n";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { app, BrowserWindow, nativeTheme, session, shell } from "electron";
import { runCauseEffect } from "../backend/effect-boundary";
import { exportStartDiagnostics } from "./maintenance-service";
import type { StartAttemptsSummary } from "./start-attempts";
import { isValidSemver } from "./update-service";

const logger = createOpenBotLogger("start-recovery");
const RELEASES_URL = "https://github.com/nightly-labs/openbot/releases";
// `.invalid` never resolves (RFC 2606), so a link that the handler did not stop goes nowhere.
const ACTION_ORIGIN = "https://openbot.invalid";
const ACTIONS = ["retry", "previous-version", "export-diagnostics", "open-data-folder", "quit"] as const;
type RecoveryAction = (typeof ACTIONS)[number];
// In memory only: the page keeps no cookies, cache or storage on the disk.
const PARTITION = "openbot-start-recovery";

type RecoveryChoice = "retry" | "quit";

interface StartRecoveryOptions {
  summary: StartAttemptsSummary;
  locale: TranslatedLocale;
  translate: AppTranslate;
  iconPath: string;
}

export interface StartRecovery {
  choice: Promise<RecoveryChoice>;
  /** Closes the window after "retry", when the main window exists. A close then does not quit. */
  close(): void;
}

/** Opens the recovery window. `choice` resolves when the user tries again or quits. */
export function openStartRecoveryWindow(options: StartRecoveryOptions): StartRecovery {
  const recoverySession = session.fromPartition(PARTITION);
  recoverySession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  recoverySession.setPermissionCheckHandler(() => false);
  // The page is one `data:` document. Nothing else loads, and nothing goes to the network.
  recoverySession.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: !details.url.startsWith("data:") }),
  );
  const window = new BrowserWindow({
    // The content size: five buttons, the texts of a long language and the notice after an export.
    width: 520,
    height: 560,
    useContentSize: true,
    minWidth: 420,
    minHeight: 420,
    show: false,
    center: true,
    title: options.translate("startup.recoveryWindowTitle"),
    icon: options.iconPath,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1c1c1e" : "#ffffff",
    autoHideMenuBar: true,
    webPreferences: {
      session: recoverySession,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  window.setMenuBarVisibility(false);
  window.once("ready-to-show", () => window.show());

  let settled = false;
  let busy = false;
  let resolveChoice: (choice: RecoveryChoice) => void = () => {};
  const choice = new Promise<RecoveryChoice>((resolve) => {
    resolveChoice = resolve;
  });
  const settle = (next: RecoveryChoice) => {
    if (settled) return;
    settled = true;
    resolveChoice(next);
  };
  const render = (notice: Notice | null) => {
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(recoveryPage(options, notice))}`);
  };

  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.on("will-redirect", (event) => event.preventDefault());
  contents.on("will-navigate", (event) => {
    // Every navigation stops here. Only an exact action URL from this page's main frame runs.
    event.preventDefault();
    if (!event.isMainFrame || event.frame !== contents.mainFrame) return;
    const action = readAction(event.url);
    if (!action || busy || settled) return;
    if (action === "retry" || action === "quit") {
      if (action === "retry") window.hide();
      settle(action);
      if (action === "quit") window.close();
      return;
    }
    busy = true;
    void runAction(action, options, window)
      .then((notice) => {
        if (notice && !window.isDestroyed()) render(notice);
      })
      .finally(() => {
        busy = false;
      });
  });
  window.on("closed", () => settle("quit"));
  render(null);

  return {
    choice,
    close: () => {
      if (!window.isDestroyed()) window.destroy();
    },
  };
}

type Notice = "diagnosticsSaved" | "actionFailed";

async function runAction(
  action: Exclude<RecoveryAction, "retry" | "quit">,
  { summary, translate }: StartRecoveryOptions,
  window: BrowserWindow,
): Promise<Notice | null> {
  try {
    if (action === "previous-version") {
      await shell.openExternal(previousVersionUrl(summary));
      return null;
    }
    if (action === "open-data-folder") {
      const failure = await shell.openPath(app.getPath("userData"));
      if (!failure) return null;
      logger.warn("Could not open the user data folder from the recovery window.");
      return "actionFailed";
    }
    const result = await runCauseEffect(
      exportStartDiagnostics({ parentWindow: window, translate, startAttempts: summary }),
    );
    return result.saved ? "diagnosticsSaved" : null;
  } catch (error) {
    logger.error(`The recovery action ${action} failed:`, toLogValue(error));
    return "actionFailed";
  }
}

/** The release page of the last version that finished a start, or the list of releases. */
function previousVersionUrl(summary: StartAttemptsSummary): string {
  const version = summary.lastGoodVersion;
  if (version && version !== summary.appVersion && isValidSemver(version))
    return `${RELEASES_URL}/tag/v${encodeURIComponent(version)}`;
  return RELEASES_URL;
}

function readAction(url: string): RecoveryAction | null {
  for (const action of ACTIONS) if (url === actionUrl(action)) return action;
  return null;
}

function actionUrl(action: RecoveryAction): string {
  return `${ACTION_ORIGIN}/recovery/${action}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function recoveryPage(options: StartRecoveryOptions, notice: Notice | null): string {
  const t = options.translate;
  const text = (value: string) => escapeHtml(value).replaceAll("\n", "<br>");
  const link = (action: RecoveryAction, label: string, primary = false) =>
    `<a class="button${primary ? " primary" : ""}" href="${escapeHtml(actionUrl(action))}">${text(label)}</a>`;
  const noticeText =
    notice === "diagnosticsSaved"
      ? t("startup.recoveryDiagnosticsSaved")
      : notice === "actionFailed"
        ? t("startup.recoveryActionFailed")
        : null;
  return `<!doctype html>
<html lang="${escapeHtml(options.locale)}" dir="${localeDirection(options.locale)}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'">
<title>${text(t("startup.recoveryWindowTitle"))}</title>
<style>
:root { color-scheme: light dark; --text: #1d1d1f; --muted: #6e6e73; --surface: #ffffff; --line: #d2d2d7; --button: #f2f2f4; --primary: #1d1d1f; --primary-text: #ffffff; }
@media (prefers-color-scheme: dark) { :root { --text: #f5f5f7; --muted: #a1a1a6; --surface: #1c1c1e; --line: #3a3a3c; --button: #2c2c2e; --primary: #f5f5f7; --primary-text: #1c1c1e; } }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { background: var(--surface); color: var(--text); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; display: flex; flex-direction: column; padding: 32px; gap: 16px; }
h1 { font-size: 20px; line-height: 1.3; margin: 0; font-weight: 600; }
p { margin: 0; }
.muted { color: var(--muted); }
.notice { border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; }
.actions { display: flex; flex-direction: column; gap: 8px; margin-top: auto; }
.button { display: block; text-align: center; text-decoration: none; color: var(--text); background: var(--button); border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; font-weight: 500; }
.button.primary { background: var(--primary); color: var(--primary-text); border-color: var(--primary); }
.button:focus-visible { outline: 1px solid var(--muted); outline-offset: 2px; }
</style>
</head>
<body>
<h1>${text(t("startup.recoveryTitle"))}</h1>
<p>${text(t("startup.recoveryBody", { version: options.summary.appVersion, count: options.summary.consecutiveFailures }))}</p>
<p class="muted">${text(t("startup.recoveryHint"))}</p>
${noticeText ? `<p class="notice" role="status">${text(noticeText)}</p>` : ""}
<div class="actions">
${link("retry", t("startup.recoveryRetry"), true)}
${link("previous-version", t("startup.recoveryPreviousVersion"))}
${link("export-diagnostics", t("startup.recoveryExportDiagnostics"))}
${link("open-data-folder", t("startup.recoveryOpenDataFolder"))}
${link("quit", t("startup.recoveryQuit"))}
</div>
</body>
</html>`;
}
