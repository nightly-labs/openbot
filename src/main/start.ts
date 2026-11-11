// The entry of the main process. `index.ts` imports its packages statically, so a program file that
// is damaged or missing stops the load before any OpenBot code runs, and Electron shows only
// "A JavaScript error occurred in the main process" (#7783, #6150). This file loads `index.ts` and
// tells the user to install OpenBot again when the load fails for that reason.
//
// It must import only `electron` and code that the build puts in `out/main`. An installed package
// here, such as `effect`, would fail in the same way and with no message.
import { resolveLocale, translateFor } from "@openbot/i18n";
import { app, dialog, shell } from "electron";
import { DOWNLOAD_URL } from "./download-url";

/**
 * True when `error` shows that a file of the installed app cannot load: a package manifest that is
 * not JSON, a module that is not there, or a module that is not JavaScript. A release build has none
 * of these unless a file changed after the install. A development build reports them as they are.
 */
function isDamagedInstallation(error: unknown): boolean {
  if (!app.isPackaged || !(error instanceof Error)) return false;
  if (error instanceof SyntaxError) return true;
  const code = "code" in error ? error.code : undefined;
  // `MODULE_NOT_FOUND` is the code of the CommonJS loader, for a package such as `ws`.
  return code === "ERR_INVALID_PACKAGE_CONFIG" || code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND";
}

/**
 * A server has no screen, so a dialog there would wait forever (see `server-mode.ts` and
 * `hosted-server-bootstrap.ts`). It exits, and its service log has the reason.
 */
function runsAsServer(): boolean {
  return (
    process.platform === "linux" && (process.env.OPENBOT_SERVER === "1" || process.env.OPENBOT_HOSTED_SERVER === "1")
  );
}

/**
 * `@openbot/logging` needs an installed package, so this writes the line itself. The error names
 * only program files.
 */
function report(message: string, error: unknown): void {
  process.stderr.write(`${message} ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
}

async function showDamagedInstallation(): Promise<void> {
  // The saved language is in the database, which no code can open here.
  const translate = translateFor(resolveLocale("system", app.getLocale()));
  const { response } = await dialog.showMessageBox({
    type: "error",
    message: translate("startup.failedTitle"),
    detail: translate("startup.filesDamagedBody"),
    buttons: [translate("startup.archiveChangedDownload"), translate("common.close")],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) await shell.openExternal(DOWNLOAD_URL);
}

// Electron sends `ready` only after this module has loaded, so the code of `index.ts` that must run
// before `ready` still does. For the same reason the dialog must not be awaited here: it needs
// `ready`, and `ready` would wait for it.
try {
  await import("./index");
} catch (error) {
  // Any other failure keeps Electron's own report, as before this file was the entry.
  if (!isDamagedInstallation(error)) throw error;
  report("OpenBot cannot start: a program file is damaged or missing.", error);
  if (runsAsServer()) {
    app.exit(1);
  } else {
    app
      .whenReady()
      .then(showDamagedInstallation)
      .catch((dialogError: unknown) => report("Could not show the damaged installation dialog.", dialogError))
      .finally(() => app.exit(1));
  }
}
