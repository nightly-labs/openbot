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

function fontListCommand(platform: NodeJS.Platform): { command: string; args: string[] } {
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
      return {
        command: "powershell.exe",
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }",
        ],
      };
    default:
      return { command: "fc-list", args: ["--format", "%{family[0]}\\n"] };
  }
}

const runFontListCommand = (platform: NodeJS.Platform) =>
  Effect.callback<string, InstalledFontsFailure>((resume) => {
    const { command, args } = fontListCommand(platform);
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

export const listInstalledFonts = Effect.fn("InstalledFonts.list")(function* (
  platform: NodeJS.Platform = process.platform,
) {
  const listed = yield* Effect.result(runFontListCommand(platform));
  if (Result.isSuccess(listed)) return parseFontFamilies(listed.success);
  logger.warn("The list of installed fonts did not load.", toLogValue(listed.failure.cause));
  return [];
});
