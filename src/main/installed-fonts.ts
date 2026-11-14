import { execFile } from "node:child_process";
import { isAppFontFamily } from "@openbot/contracts/app-appearance";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect, Result, Schema } from "effect";

const logger = createOpenBotLogger("installed-fonts");

const LIST_TIMEOUT_MS = 10_000;
const LIST_MAX_BUFFER = 8 * 1024 * 1024;

class InstalledFontsFailure extends Schema.TaggedError<InstalledFontsFailure>()("InstalledFontsFailure", {
  cause: Schema.Defect(),
}) {}

interface FontCommand {
  command: string;
  args: string[];
}

function powerShellCommand(script: string): FontCommand {
  return {
    command: "powershell.exe",
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${script}`,
    ],
  };
}

/**
 * The command that writes one family name on each line. Each one is part of the system: AppKit
 * through JavaScript for Automation on macOS, Fontconfig on Linux, and .NET through PowerShell on
 * Windows. The renderer could ask Chromium (`queryLocalFonts`), but that needs a new permission.
 */
function fontListCommand(platform: NodeJS.Platform): FontCommand {
  switch (platform) {
    case "darwin":
      return {
        command: "/usr/bin/osascript",
        args: [
          "-l",
          "JavaScript",
          "-e",
          'ObjC.import("AppKit"); ObjC.deepUnwrap($.NSFontManager.sharedFontManager.availableFontFamilies).join("\\n")',
        ],
      };
    case "win32":
      return powerShellCommand(
        "Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }",
      );
    default:
      return { command: "fc-list", args: ["--format", "%{family[0]}\\n"] };
  }
}

/**
 * The Windows command that writes the family names of the symbol fonts, such as Wingdings, Webdings
 * and Marlett. A symbol font has a picture for each letter, so the default fonts after it never draw
 * the letters, and all text in it is unreadable. `Win32FamilyNames` are the names, in each language,
 * that `InstalledFontCollection` writes. `SystemFontFamilies` has only the fonts of all users, so the
 * command also reads the fonts of this user. A font that does not load is skipped, so it does not stop
 * the others.
 */
const WINDOWS_SYMBOL_FONTS_COMMAND = powerShellCommand(
  [
    "Add-Type -AssemblyName PresentationCore",
    "$families = @([System.Windows.Media.Fonts]::SystemFontFamilies)",
    "try { $families += @([System.Windows.Media.Fonts]::GetFontFamilies((Join-Path $env:LOCALAPPDATA 'Microsoft\\Windows\\Fonts\\'))) } catch {}",
    "foreach ($family in $families) { try { foreach ($typeface in $family.GetTypefaces()) { $glyphs = $null; if ($typeface.TryGetGlyphTypeface([ref]$glyphs) -and $glyphs.Symbol) { $glyphs.Win32FamilyNames.Values } } } catch {} }",
    "exit 0",
  ].join("; "),
);

const runFontCommand = ({ command, args }: FontCommand) =>
  Effect.callback<string, InstalledFontsFailure>((resume) => {
    const child = execFile(
      command,
      args,
      { encoding: "utf8", timeout: LIST_TIMEOUT_MS, maxBuffer: LIST_MAX_BUFFER, windowsHide: true },
      (error, stdout) => {
        resume(error ? Effect.fail(new InstalledFontsFailure({ cause: error })) : Effect.succeed(stdout));
      },
    );
    return Effect.sync(() => {
      child.kill();
    });
  });

/**
 * The family names, one time each, in alphabetical order. A name that starts with a dot is a font
 * that macOS keeps for itself. A name that cannot go into a CSS font list is left out.
 */
function parseFontFamilies(output: string): string[] {
  const families = new Set<string>();
  for (const line of output.split(/\r?\n/u)) {
    const family = line.trim();
    if (family.startsWith(".") || !isAppFontFamily(family)) continue;
    families.add(family);
  }
  return [...families].sort((left, right) => left.localeCompare(right));
}

/**
 * The symbol fonts from the first scan that loaded. The scan opens each font file, so Settings does
 * not repeat it each time it opens. A symbol font that is installed later shows until a restart.
 */
let symbolFontsCache: ReadonlySet<string> | null = null;

/**
 * The symbol fonts to leave out of the font choices. Only Windows has a system command for them. When
 * the command fails, no font is left out, so the font choices stay as they were.
 */
const listSymbolFonts = Effect.fn("InstalledFonts.listSymbolFonts")(function* (platform: NodeJS.Platform) {
  if (platform !== "win32") return new Set<string>();
  if (symbolFontsCache !== null) return symbolFontsCache;
  const listed = yield* Effect.result(runFontCommand(WINDOWS_SYMBOL_FONTS_COMMAND));
  if (Result.isSuccess(listed)) {
    const symbolFonts = new Set(parseFontFamilies(listed.success));
    // Windows always has symbol fonts, such as Marlett. No names means that the scan did not run.
    if (symbolFonts.size > 0) symbolFontsCache = symbolFonts;
    return symbolFonts;
  }
  logger.warn("The list of symbol fonts did not load.", toLogValue(listed.failure.cause));
  return new Set<string>();
});

/**
 * The fonts that are installed on this computer, for the font choices in Settings. When the list
 * does not load, such as on a Linux computer without Fontconfig, it is empty: Settings then shows
 * only the default font and the saved one.
 */
export const listInstalledFonts = Effect.fn("InstalledFonts.list")(function* (
  platform: NodeJS.Platform = process.platform,
) {
  const [listed, symbolFonts] = yield* Effect.all(
    [Effect.result(runFontCommand(fontListCommand(platform))), listSymbolFonts(platform)],
    { concurrency: "unbounded" },
  );
  if (Result.isSuccess(listed)) return parseFontFamilies(listed.success).filter((family) => !symbolFonts.has(family));
  logger.warn("The list of installed fonts did not load.", toLogValue(listed.failure.cause));
  return [];
});
