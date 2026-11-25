import type { AppTranslate, TranslatedLocale } from "@openbot/i18n";
import { localeDirection } from "@openbot/i18n";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { app, BrowserWindow, nativeTheme, session, shell } from "electron";
import { runCauseEffect } from "../backend/effect-boundary";
import { DOWNLOAD_URL, RELEASES_URL } from "./download-url";
import { exportStartDiagnostics } from "./maintenance-service";
import type { StartAttemptsSummary } from "./start-attempts";
import { recoveryPlushSvg } from "./start-recovery-plush";

const logger = createOpenBotLogger("start-recovery");
const ACTION_ORIGIN = "https://openbot.invalid";
const ACTIONS = [
  "retry",
  "previous-version",
  "latest-version",
  "export-diagnostics",
  "open-data-folder",
  "quit",
] as const;
type RecoveryAction = (typeof ACTIONS)[number];
const PARTITION = "openbot-start-recovery";

type RecoveryChoice = "retry" | "quit";

interface StartRecoveryOptions {
  summary: StartAttemptsSummary;
  previousRelease: string | null;
  locale: TranslatedLocale;
  translate: AppTranslate;
  iconPath: string;
  showWithoutFocus: boolean;
}

export interface StartRecovery {
  choice: Promise<RecoveryChoice>;
  close(): void;
}

export function openStartRecoveryWindow(options: StartRecoveryOptions): StartRecovery {
  const recoverySession = session.fromPartition(PARTITION);
  recoverySession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  recoverySession.setPermissionCheckHandler(() => false);
  recoverySession.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: !details.url.startsWith("data:") }),
  );
  const window = new BrowserWindow({
    width: 520,
    height: 640,
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
  window.once("ready-to-show", () => (options.showWithoutFocus ? window.showInactive() : window.show()));

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
  const plush = recoveryPlushSvg();
  const render = (notice: Notice | null) => {
    const page = recoveryPage(options, plush, notice);
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
  };

  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.on("will-redirect", (event) => event.preventDefault());
  contents.on("will-navigate", (event) => {
    event.preventDefault();
    if (!event.isMainFrame || event.frame !== contents.mainFrame) return;
    const action = readAction(event.url, options.previousRelease);
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
  { summary, previousRelease, translate }: StartRecoveryOptions,
  window: BrowserWindow,
): Promise<Notice | null> {
  try {
    if (action === "previous-version" || action === "latest-version") {
      await shell.openExternal(
        previousRelease ? `${RELEASES_URL}/tag/v${encodeURIComponent(previousRelease)}` : DOWNLOAD_URL,
      );
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

function readAction(url: string, previousRelease: string | null): RecoveryAction | null {
  const hidden: RecoveryAction = previousRelease ? "latest-version" : "previous-version";
  for (const action of ACTIONS) if (action !== hidden && url === actionUrl(action)) return action;
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

function recoveryPage(options: StartRecoveryOptions, plush: string | null, notice: Notice | null): string {
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
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'">
<title>${text(t("startup.recoveryWindowTitle"))}</title>
<style>
:root { color-scheme: light dark; --text: #1d1d1f; --muted: #6e6e73; --surface: #ffffff; --line: #d2d2d7; --button: #f2f2f4; --primary: #1d1d1f; --primary-text: #ffffff; }
@media (prefers-color-scheme: dark) { :root { --text: #f5f5f7; --muted: #a1a1a6; --surface: #1c1c1e; --line: #3a3a3c; --button: #2c2c2e; --primary: #f5f5f7; --primary-text: #1c1c1e; } }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { background: var(--surface); color: var(--text); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; display: flex; flex-direction: column; padding: 24px 32px 32px; gap: 16px; text-align: center; }
h1 { font-size: 20px; line-height: 1.3; margin: 0; font-weight: 600; }
.plush { display: block; width: 132px; height: 120px; margin: 0 auto -4px; overflow: visible; transform-origin: 50% 88%; }
.plush-eyes { transform-box: view-box; transform-origin: 0 0; }
.intro .plush { animation: plush-land 700ms cubic-bezier(0.3, 0, 0.3, 1) both, plush-shake 900ms ease-in-out 900ms, plush-breathe 3600ms ease-in-out 2000ms infinite; }
.intro .plush-eyes { animation: plush-look 900ms ease-in-out 900ms; }
body:not(.intro) .plush { animation: plush-breathe 3600ms ease-in-out infinite; }
@keyframes plush-land { 0% { opacity: 0; transform: translateY(-48px); } 55% { opacity: 1; transform: translateY(0) scale(1.08, 0.88); } 75% { transform: translateY(-4px) scale(0.97, 1.04); } 100% { transform: none; } }
@keyframes plush-shake { 0%, 100% { transform: none; } 20% { transform: rotate(-4deg); } 45% { transform: rotate(3.5deg); } 70% { transform: rotate(-2deg); } 88% { transform: rotate(1deg); } }
@keyframes plush-look { 0%, 100% { transform: none; } 20% { transform: translateX(-9px); } 45% { transform: translateX(8px); } 70% { transform: translateX(-4px); } 88% { transform: translateX(2px); } }
@keyframes plush-breathe { 0%, 100% { transform: none; } 50% { transform: scale(1.015, 0.985); } }
@media (prefers-reduced-motion: reduce) { .plush, .plush-eyes { animation: none !important; } }
p { margin: 0; }
.muted { color: var(--muted); }
.notice { border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; }
.actions { display: flex; flex-direction: column; gap: 8px; margin-top: auto; }
.button { display: block; text-align: center; text-decoration: none; color: var(--text); background: var(--button); border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; font-weight: 500; }
.button.primary { background: var(--primary); color: var(--primary-text); border-color: var(--primary); }
.button:focus-visible { outline: 1px solid var(--muted); outline-offset: 2px; }
</style>
</head>
<body${notice ? "" : ' class="intro"'}>
${plush ?? ""}
<h1>${text(t("startup.recoveryTitle"))}</h1>
<p>${text(t("startup.recoveryBody", { version: options.summary.appVersion, count: options.summary.consecutiveFailures }))}</p>
<p class="muted">${text(t(options.previousRelease ? "startup.recoveryHint" : "startup.recoveryHintLatest"))}</p>
${noticeText ? `<p class="notice" role="status">${text(noticeText)}</p>` : ""}
<div class="actions">
${link("retry", t("startup.recoveryRetry"), true)}
${
  options.previousRelease
    ? link("previous-version", t("startup.recoveryPreviousVersion"))
    : link("latest-version", t("startup.recoveryLatestVersion"))
}
${link("export-diagnostics", t("startup.recoveryExportDiagnostics"))}
${link("open-data-folder", t("startup.recoveryOpenDataFolder"))}
${link("quit", t("startup.recoveryQuit"))}
</div>
</body>
</html>`;
}
