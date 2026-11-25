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

function parseFontFamilies(output: string): string[] {
  const families = new Set<string>();
  for (const line of output.split(/\r?\n/u)) {
    const family = line.trim();
    if (family.startsWith(".") || !isAppFontFamily(family)) continue;
    families.add(family);
  }
  return [...families].sort((left, right) => left.localeCompare(right));
}

let symbolFontsCache: ReadonlySet<string> | null = null;

const scanSymbolFonts = Effect.fn("InstalledFonts.scanSymbolFonts")(function* () {
  const listed = yield* Effect.result(runFontCommand(WINDOWS_SYMBOL_FONTS_COMMAND));
  if (Result.isSuccess(listed)) return new Set(parseFontFamilies(listed.success));
  logger.warn("The list of symbol fonts did not load.", toLogValue(listed.failure.cause));
  return new Set<string>();
});

const listSymbolFonts = Effect.fn("InstalledFonts.listSymbolFonts")(function* (platform: NodeJS.Platform) {
  if (platform !== "win32") return new Set<string>();
  symbolFontsCache ??= yield* scanSymbolFonts();
  return symbolFontsCache;
});

let fontListCache: string[] | null = null;
let fontListScan: Effect.Effect<string[]> | null = null;

const scanFontList = Effect.fn("InstalledFonts.scanFontList")(function* (platform: NodeJS.Platform) {
  const [listed, symbolFonts] = yield* Effect.all(
    [Effect.result(runFontCommand(fontListCommand(platform))), listSymbolFonts(platform)],
    { concurrency: "unbounded" },
  );
  if (Result.isSuccess(listed)) {
    fontListCache = parseFontFamilies(listed.success).filter((family) => !symbolFonts.has(family));
    return fontListCache;
  }
  logger.warn("The list of installed fonts did not load.", toLogValue(listed.failure.cause));
  return fontListCache ?? [];
});

function sharedFontListScan(platform: NodeJS.Platform): Effect.Effect<string[]> {
  fontListScan ??= Effect.runSync(
    Effect.cached(
      scanFontList(platform).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            fontListScan = null;
          }),
        ),
      ),
    ),
  );
  return fontListScan;
}

export const listInstalledFonts = Effect.fn("InstalledFonts.list")(function* (
  platform: NodeJS.Platform = process.platform,
) {
  const scan = sharedFontListScan(platform);
  if (fontListCache === null) return yield* scan;
  yield* Effect.forkDetach(scan);
  return fontListCache;
});
