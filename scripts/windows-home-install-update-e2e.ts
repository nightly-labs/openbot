// Drives the real Windows installers on a Windows computer that has no OpenBot, such as a CI
// runner. It removes every OpenBot installation, %USERPROFILE%\OpenBot and the OpenBot registry
// entries of this user, so do not run it on a computer that you use.
//
// An installation in %USERPROFILE%\OpenBot shares its folder with the agent workspaces. An update
// runs the earlier uninstaller, which moves each file of the folder to a temporary folder and
// deletes it. The cases:
//   1. A normal update from the default folder keeps working, and it does not touch the workspaces.
//   2. The earlier uninstaller, run as an update runs it, stops with exit code 2 when a workspace
//      file has a path that fits in the folder but not in the temporary folder.
//   3. Without such a file, the same uninstaller deletes the workspaces.
//   4. The new installer updates the installation in %USERPROFILE%\OpenBot: it installs in the
//      default folder, keeps the workspaces, and removes only the earlier app.
// Usage: bun scripts/windows-home-install-update-e2e.ts <earlier installer> <new installer>
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";

const logger = createOpenBotLogger("windows-home-install-update-e2e");

if (process.platform !== "win32") throw new Error("This test drives the Windows installers and must run on Windows.");
// It deletes %USERPROFILE%\OpenBot, so it runs only on a GitHub Actions runner.
if (process.env.GITHUB_ACTIONS !== "true") {
  throw new Error("This test deletes %USERPROFILE%\\OpenBot and runs only on a GitHub Actions runner.");
}

const [earlierInstallerArgument, newInstallerArgument] = process.argv.slice(2);
if (!earlierInstallerArgument || !newInstallerArgument) {
  throw new Error("Usage: bun scripts/windows-home-install-update-e2e.ts <earlier installer> <new installer>");
}
const earlierInstaller = resolve(earlierInstallerArgument);
const newInstaller = resolve(newInstallerArgument);
const localAppData = process.env.LOCALAPPDATA;
if (!localAppData) throw new Error("LOCALAPPDATA is not set.");

const homeFolder = join(homedir(), "OpenBot");
const defaultFolder = join(localAppData, "Programs", "OpenBot");
// Missing on a computer where no program was installed for this user.
const uninstallKey = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall";
const runKey = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const loginItemName = "app.openbot.desktop";
const reportPath = resolve(".openbot-build/windows-home-install-update-e2e.json");
// An installer that waits for a dialog in a silent run does not exit. This limit makes that a failure.
const installerLimitMs = 5 * 60_000;
// Below MAX_PATH (260) in the folder, above it in %TEMP%\nsXXXX.tmp\old-install, where the earlier
// uninstaller moves it.
const longPathLength = 250;

const workspaceFiles = [
  join("Agents", "demo", "notes.md"),
  join("Agents", "demo", "src", "index.ts"),
  join("Shared", "report.txt"),
  join("Downloads", "picture.txt"),
];
const appFiles = ["OpenBot.exe", "Uninstall OpenBot.exe", "resources", "locales", "ffmpeg.dll", "resources.pak"];

interface Registration {
  displayName: string | null;
  uninstallString: string | null;
  installLocation: string | null;
}

interface CaseResult {
  exitCode: number;
  missingWorkspaceFiles: string[];
  registration?: Registration;
  loginItem?: string;
  appFilesInDefaultFolder?: string[];
  appFilesInHomeFolder?: string[];
  longPathLength?: number | undefined;
  temporaryFolder?: string;
}

const cases: {
  normalUpdate?: CaseResult;
  earlierUninstallerStops?: CaseResult;
  earlierUninstallerDeletesWorkspaces?: CaseResult;
  newInstallerMovesTheInstallation?: CaseResult;
} = {};
const report: {
  earlierInstaller: string;
  newInstaller: string;
  homeFolder: string;
  defaultFolder: string;
  cases: typeof cases;
  passed?: boolean;
  failure?: string | null;
} = { earlierInstaller, newInstaller, homeFolder, defaultFolder, cases };

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function powershell(script: string): string {
  return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
  }).trim();
}

// NSIS reads /D= and _?= only as the last argument and only without quotes, so the arguments are
// written as they are. The paths of a CI runner have no spaces.
function runInstaller(file: string, args: string): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(file, [args], { windowsVerbatimArguments: true, stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${file} ${args} did not exit; it probably shows a dialog.`));
    }, installerLimitMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolvePromise(code ?? -1);
    });
  });
}

function registration(): Registration {
  const json = powershell(`
    $entry = $null
    if (Test-Path ${uninstallKey}) {
      $entry = Get-ChildItem ${uninstallKey} | Get-ItemProperty |
        Where-Object { $_.DisplayName -like 'OpenBot*' } | Select-Object -First 1
    }
    $location = $null
    if ($entry) { $location = (Get-ItemProperty -LiteralPath "HKCU:\\Software\\$($entry.PSChildName)" -ErrorAction SilentlyContinue).InstallLocation }
    [pscustomobject]@{ displayName = $entry.DisplayName; uninstallString = $entry.UninstallString; installLocation = $location } |
      ConvertTo-Json -Compress`);
  const value = JSON.parse(json);
  if (!isDynamicRecord(value)) throw new Error("The registry query did not return an object.");
  const text = (key: string) => {
    const entry = value[key];
    return isString(entry) ? entry : null;
  };
  return {
    displayName: text("displayName"),
    uninstallString: text("uninstallString"),
    installLocation: text("installLocation"),
  };
}

function loginItem(): string {
  return powershell(`(Get-ItemProperty -LiteralPath '${runKey}' -ErrorAction SilentlyContinue).'${loginItemName}'`);
}

function setLoginItem(executable: string): void {
  powershell(
    `New-ItemProperty -LiteralPath '${runKey}' -Name '${loginItemName}' -Value '"${executable}"' -PropertyType String -Force | Out-Null`,
  );
}

async function removeEverything(): Promise<void> {
  const keys = powershell(`
    if (Test-Path ${uninstallKey}) {
      Get-ChildItem ${uninstallKey} | Get-ItemProperty |
        Where-Object { $_.DisplayName -like 'OpenBot*' } | ForEach-Object { $_.PSChildName }
    }`);
  // A key or value that is already gone still makes `$?` false, so each cleanup ends with exit 0.
  for (const key of keys.split(/\r?\n/u).filter(Boolean)) {
    powershell(`Remove-Item -LiteralPath "${uninstallKey}\\${key}" -Recurse -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath "HKCU:\\Software\\${key}" -Recurse -Force -ErrorAction SilentlyContinue
      exit 0`);
  }
  powershell(`Remove-ItemProperty -LiteralPath '${runKey}' -Name '${loginItemName}' -ErrorAction SilentlyContinue
    exit 0`);
  for (const folder of [homeFolder, defaultFolder]) await rm(folder, { recursive: true, force: true });
}

// Node writes paths longer than MAX_PATH; NSIS cannot move them to a longer path.
async function makeWorkspaces(options: { longPath: boolean }): Promise<string | null> {
  for (const file of workspaceFiles) {
    await mkdir(dirname(join(homeFolder, file)), { recursive: true });
    await writeFile(join(homeFolder, file), `content of ${file}\n`);
  }
  if (!options.longPath) return null;
  let folder = join(homeFolder, "Agents", "demo", "node_modules");
  const name = "index.js";
  while (folder.length + 1 + "package-with-a-long-name".length + 1 + name.length < longPathLength) {
    folder = join(folder, "package-with-a-long-name");
  }
  const file = join(folder, `${"x".repeat(longPathLength - folder.length - 1 - name.length)}${name}`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, "module.exports = 1;\n");
  return file;
}

async function workspacesIntact(longPathFile: string | null): Promise<string[]> {
  const missing: string[] = [];
  for (const file of workspaceFiles) {
    const path = join(homeFolder, file);
    if (!existsSync(path) || (await readFile(path, "utf8")) !== `content of ${file}\n`) missing.push(file);
  }
  if (longPathFile && !existsSync(longPathFile)) missing.push(longPathFile);
  return missing;
}

function presentAppFiles(folder: string): string[] {
  return appFiles.filter((file) => existsSync(join(folder, file)));
}

// The earlier uninstaller as `uninstallOldVersion` in electron-builder 26 runs it during an update:
// copied out of the folder, silent, in update mode.
async function runEarlierUninstallerAsUpdate(): Promise<number> {
  const copyFolder = await mkdtemp(join(tmpdir(), "openbot-old-uninstaller-"));
  const copy = join(copyFolder, "old-uninstaller.exe");
  await copyFile(join(homeFolder, "Uninstall OpenBot.exe"), copy);
  try {
    return await runInstaller(copy, `/S /KEEP_APP_DATA /currentuser --updated _?=${homeFolder}`);
  } finally {
    await rm(copyFolder, { recursive: true, force: true });
  }
}

async function installEarlierInHomeFolder(): Promise<void> {
  await removeEverything();
  check((await runInstaller(earlierInstaller, `/S /D=${homeFolder}`)) === 0, "The earlier installer failed.");
  check(existsSync(join(homeFolder, "OpenBot.exe")), "The earlier installer did not install in the home folder.");
}

async function normalUpdate(): Promise<void> {
  await removeEverything();
  check((await runInstaller(earlierInstaller, "/S")) === 0, "The earlier installer failed.");
  check(existsSync(join(defaultFolder, "OpenBot.exe")), "The earlier installer did not use the default folder.");
  await makeWorkspaces({ longPath: false });
  const exitCode = await runInstaller(newInstaller, "--updated /S");
  const result = {
    exitCode,
    registration: registration(),
    appFilesInDefaultFolder: presentAppFiles(defaultFolder),
    missingWorkspaceFiles: await workspacesIntact(null),
  };
  cases.normalUpdate = result;
  check(exitCode === 0, `The normal update exited with ${exitCode}.`);
  check(result.registration.installLocation === defaultFolder, "The normal update moved the installation.");
  check(result.appFilesInDefaultFolder.includes("OpenBot.exe"), "The normal update did not install OpenBot.exe.");
  check(result.missingWorkspaceFiles.length === 0, "The normal update changed the workspaces.");
}

async function earlierUninstallerStops(): Promise<void> {
  await installEarlierInHomeFolder();
  const longPathFile = await makeWorkspaces({ longPath: true });
  const exitCode = await runEarlierUninstallerAsUpdate();
  const result = {
    exitCode,
    longPathLength: longPathFile?.length,
    temporaryFolder: tmpdir(),
    missingWorkspaceFiles: await workspacesIntact(longPathFile),
    appFilesInHomeFolder: presentAppFiles(homeFolder),
  };
  cases.earlierUninstallerStops = result;
  check(exitCode === 2, `The earlier uninstaller exited with ${exitCode}, not 2.`);
  check(result.missingWorkspaceFiles.length === 0, "The earlier uninstaller did not restore the workspaces.");
}

async function earlierUninstallerDeletesWorkspaces(): Promise<void> {
  await installEarlierInHomeFolder();
  await makeWorkspaces({ longPath: false });
  const exitCode = await runEarlierUninstallerAsUpdate();
  const result = { exitCode, missingWorkspaceFiles: await workspacesIntact(null) };
  cases.earlierUninstallerDeletesWorkspaces = result;
  check(exitCode === 0, `The earlier uninstaller exited with ${exitCode}, not 0.`);
  check(result.missingWorkspaceFiles.length === workspaceFiles.length, "The earlier uninstaller kept the workspaces.");
}

async function newInstallerMovesTheInstallation(): Promise<void> {
  await installEarlierInHomeFolder();
  const longPathFile = await makeWorkspaces({ longPath: true });
  setLoginItem(join(homeFolder, "OpenBot.exe"));
  const exitCode = await runInstaller(newInstaller, "--updated /S");
  const result = {
    exitCode,
    registration: registration(),
    loginItem: loginItem(),
    appFilesInDefaultFolder: presentAppFiles(defaultFolder),
    appFilesInHomeFolder: presentAppFiles(homeFolder),
    missingWorkspaceFiles: await workspacesIntact(longPathFile),
  };
  cases.newInstallerMovesTheInstallation = result;
  check(exitCode === 0, `The new installer exited with ${exitCode}.`);
  check(result.missingWorkspaceFiles.length === 0, `Workspace files are missing: ${result.missingWorkspaceFiles}`);
  check(result.appFilesInDefaultFolder.includes("OpenBot.exe"), "The new installer did not use the default folder.");
  check(result.appFilesInHomeFolder.length === 0, `App files stay in the home folder: ${result.appFilesInHomeFolder}`);
  check(result.registration.installLocation === defaultFolder, "The registry does not name the default folder.");
  check(
    result.registration.uninstallString?.includes(defaultFolder) === true,
    "The uninstall entry does not name the default folder.",
  );
  check(result.loginItem === `"${join(defaultFolder, "OpenBot.exe")}"`, "The login item does not name the new copy.");
}

let failure: unknown = null;
try {
  for (const step of [
    normalUpdate,
    earlierUninstallerStops,
    earlierUninstallerDeletesWorkspaces,
    newInstallerMovesTheInstallation,
  ]) {
    await step();
  }
} catch (error) {
  failure = error;
} finally {
  report.passed = failure === null;
  report.failure = failure instanceof Error ? failure.message : failure === null ? null : String(failure);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await removeEverything();
}
logger.info("Windows home install update report", { path: reportPath, passed: report.passed, failure: report.failure });
if (failure) throw failure;
