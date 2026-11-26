import type { AppTextKey, AppTranslate, TranslatedLocale } from "@openbot/i18n";
import { localeDirection } from "@openbot/i18n";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { app, BrowserWindow, dialog, nativeTheme, session, shell } from "electron";
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
const ACTION_LABELS: Record<RecoveryAction, AppTextKey> = {
  retry: "startup.recoveryRetry",
  "previous-version": "startup.recoveryPreviousVersion",
  "latest-version": "startup.recoveryLatestVersion",
  "export-diagnostics": "startup.recoveryExportDiagnostics",
  "open-data-folder": "startup.recoveryOpenDataFolder",
  quit: "startup.recoveryQuit",
};
const PARTITION = "openbot-start-recovery";
const WINDOW_SHOW_TIMEOUT_MS = 15_000;
const REPLACED_LOAD_ERROR = -3;

type RecoveryChoice = "retry" | "quit";

interface StartRecoveryOptions {
  summary: StartAttemptsSummary;
  previousRelease: string | null;
  locale: TranslatedLocale;
  translate: AppTranslate;
  iconPath: string;
  showWithoutFocus: boolean;
  stopsRenderer: boolean;
}

export interface StartRecovery {
  choice: Promise<RecoveryChoice>;
  present(): void;
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

  let settled = false;
  let busy = false;
  let shown = false;
  let dialogShown = false;
  let resolveChoice: (choice: RecoveryChoice) => void = () => {};
  const choice = new Promise<RecoveryChoice>((resolve) => {
    resolveChoice = resolve;
  });
  const settle = (next: RecoveryChoice) => {
    if (settled) return;
    settled = true;
    clearTimeout(showDeadline);
    resolveChoice(next);
  };
  const showDialogInstead = (reason: string) => {
    if (settled || dialogShown) return;
    dialogShown = true;
    clearTimeout(showDeadline);
    logger.warn(`The recovery window cannot show (${reason}). Showing the recovery dialog.`);
    if (!window.isDestroyed()) window.hide();
    runRecoveryDialog(options).then(settle, (error: unknown) => {
      logger.error("The recovery dialog failed:", toLogValue(error));
      settle("quit");
    });
  };
  const showDeadline = setTimeout(() => {
    if (!shown) showDialogInstead("it did not load in time");
  }, WINDOW_SHOW_TIMEOUT_MS);
  window.once("ready-to-show", () => {
    if (dialogShown || settled) return;
    shown = true;
    clearTimeout(showDeadline);
    if (options.showWithoutFocus) window.showInactive();
    else window.show();
  });
  const plush = recoveryPlushSvg();
  const render = (notice: Notice | null) => {
    const page = recoveryPage(options, plush, notice);
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`).catch(() => undefined);
  };

  const contents = window.webContents;
  contents.on("render-process-gone", (_event, details) =>
    showDialogInstead(`its renderer stopped: ${details.reason}, exit code ${details.exitCode}`),
  );
  contents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
    if (isMainFrame && code !== REPLACED_LOAD_ERROR) showDialogInstead(`${description} (${code})`);
  });
  if (options.stopsRenderer) contents.once("did-navigate", () => contents.forcefullyCrashRenderer());
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
    present: () => {
      if (dialogShown || !shown || window.isDestroyed()) return;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    },
    close: () => {
      clearTimeout(showDeadline);
      if (!window.isDestroyed()) window.destroy();
    },
  };
}

type Notice = "diagnosticsSaved" | "actionFailed";

async function runRecoveryDialog(options: StartRecoveryOptions): Promise<RecoveryChoice> {
  const t = options.translate;
  const actions: RecoveryAction[] = [
    "retry",
    options.previousRelease ? "previous-version" : "latest-version",
    "export-diagnostics",
    "open-data-folder",
    "quit",
  ];
  let notice: Notice | null = null;
  for (;;) {
    const { body, hint } = recoveryText(options);
    const shownNotice = noticeText(t, notice);
    const { response } = await dialog.showMessageBox({
      type: "warning",
      title: t("startup.recoveryWindowTitle"),
      message: t("startup.recoveryTitle"),
      detail: shownNotice ? `${body}\n\n${hint}\n\n${shownNotice}` : `${body}\n\n${hint}`,
      buttons: actions.map((action) => t(ACTION_LABELS[action])),
      defaultId: 0,
      cancelId: actions.length - 1,
      noLink: true,
    });
    const action = actions[response] ?? "quit";
    if (action === "retry" || action === "quit") return action;
    notice = await runAction(action, options, null);
  }
}

function recoveryText(options: StartRecoveryOptions): { body: string; hint: string } {
  const t = options.translate;
  return {
    body: t("startup.recoveryBody", {
      version: options.summary.appVersion,
      count: options.summary.consecutiveFailures,
    }),
    hint: t(options.previousRelease ? "startup.recoveryHint" : "startup.recoveryHintLatest"),
  };
}

function noticeText(t: AppTranslate, notice: Notice | null): string | null {
  if (notice === "diagnosticsSaved") return t("startup.recoveryDiagnosticsSaved");
  if (notice === "actionFailed") return t("startup.recoveryActionFailed");
  return null;
}

async function runAction(
  action: Exclude<RecoveryAction, "retry" | "quit">,
  { summary, previousRelease, translate }: StartRecoveryOptions,
  window: BrowserWindow | null,
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
  const link = (action: RecoveryAction, primary = false) =>
    `<a class="button${primary ? " primary" : ""}" href="${escapeHtml(actionUrl(action))}">${text(t(ACTION_LABELS[action]))}</a>`;
  const { body, hint } = recoveryText(options);
  const shownNotice = noticeText(t, notice);
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
<p>${text(body)}</p>
<p class="muted">${text(hint)}</p>
${shownNotice ? `<p class="notice" role="status">${text(shownNotice)}</p>` : ""}
<div class="actions">
${link("retry", true)}
${link(options.previousRelease ? "previous-version" : "latest-version")}
${link("export-diagnostics")}
${link("open-data-folder")}
${link("quit")}
</div>
</body>
</html>`;
}
