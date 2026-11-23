import { execFile } from "node:child_process";
import { normalize, win32 } from "node:path";
import { Effect, Schema } from "effect";

/**
 * The Windows update signature check. It replaces the one of electron-updater 6.8.11, which starts a
 * bare `powershell.exe` from PATH and reads the full `Get-AuthenticodeSignature | ConvertTo-Json`
 * output. When PATH gives PowerShell 7, that output gets a depth warning, the JSON does not parse, and
 * every update fails (#10966). The process launch follows electron-builder 7.0
 * (`packages/builder-util-runtime/src/authenticodeSignature.ts`, MIT, Copyright (c) 2015 Loopline
 * Systems): Windows PowerShell 5.1 by absolute path, no shell, the file in an environment variable.
 */

const VERIFY_TIMEOUT_MS = 60_000;
const FILE_ENV = "OPENBOT_UPDATE_SIGNATURE_FILE";

class SignatureCheckFailed extends Schema.TaggedError<SignatureCheckFailed>()("SignatureCheckFailed", {
  reason: Schema.String,
}) {}

// Prints only the three fields that the check reads, so the JSON has no depth to cut and no PowerShell
// version prints a warning. Non-ASCII text is escaped as \uXXXX, so the certificate subject reads back
// the same whatever the console code page. Every construct is allowed in Constrained Language Mode.
const SCRIPT = [
  "$ProgressPreference = 'SilentlyContinue'",
  "$WarningPreference = 'SilentlyContinue'",
  'Import-Module "$PSHOME\\Modules\\Microsoft.PowerShell.Security"',
  'Import-Module "$PSHOME\\Modules\\Microsoft.PowerShell.Utility"',
  "function ConvertTo-AsciiEscaped([string]$text) { if ($text -cmatch '[^\\x00-\\x7F]') { -join $(foreach ($c in $text.ToCharArray()) { if ([int]$c -gt 127) { '\\u{0:x4}' -f [int]$c } else { $c } }) } else { $text } }",
  `$signature = Get-AuthenticodeSignature -LiteralPath $env:${FILE_ENV} -ErrorAction Stop`,
  "$subject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }",
  "ConvertTo-AsciiEscaped (@{ Status = [int]$signature.Status; Path = $signature.Path; Subject = $subject } | ConvertTo-Json -Compress)",
].join("; ");

function windowsPowerShellPath(): string | null {
  const systemRoot = process.env.SystemRoot || process.env.windir;
  // A relative or drive-relative value would be resolved against the current directory again.
  if (!systemRoot || !/^[a-zA-Z]:[\\/]/.test(systemRoot)) return null;
  return win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function runSignatureScript(file: string): Effect.Effect<string, SignatureCheckFailed> {
  return Effect.callback<string, SignatureCheckFailed>((resume, signal) => {
    const powershell = windowsPowerShellPath();
    if (!powershell) {
      resume(Effect.fail(new SignatureCheckFailed({ reason: "Windows PowerShell was not found." })));
      return;
    }
    // Windows PowerShell rebuilds PSModulePath; the modules are imported from $PSHOME in the script.
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (key.toLowerCase() !== "psmodulepath" && key.toLowerCase() !== FILE_ENV.toLowerCase()) env[key] = value;
    }
    env[FILE_ENV] = file;
    const args = ["-NoProfile", "-NonInteractive", "-InputFormat", "None", "-EncodedCommand"];
    args.push(Buffer.from(SCRIPT, "utf16le").toString("base64"));
    execFile(
      powershell,
      args,
      { env, timeout: VERIFY_TIMEOUT_MS, windowsHide: true, signal },
      (error, stdout, stderr) => {
        if (error) {
          const result = error.killed ? "did not finish in time" : `exited with code ${String(error.code)}`;
          const reason = `Get-AuthenticodeSignature ${result}. ${stderr.trim().slice(0, 500)}`.trim();
          resume(Effect.fail(new SignatureCheckFailed({ reason })));
        } else resume(Effect.succeed(stdout));
      },
    );
  });
}

// The fields that the script prints. Status is `SignatureStatus`, where Valid is 0.
const signatureOutputSchema = Schema.Struct({
  Status: Schema.Number,
  Path: Schema.NullOr(Schema.String),
  Subject: Schema.NullOr(Schema.String),
});

// PowerShell rebuilds a drive-qualified path from the root of the drive, so the drive letter can change case.
function comparablePath(file: string): string {
  return normalize(file).replace(/^[a-z]:/, (drive) => drive.toUpperCase());
}

function parseSignature(stdout: string, file: string): Effect.Effect<string, SignatureCheckFailed> {
  return Effect.try({
    try: () => Schema.decodeUnknownSync(signatureOutputSchema)(JSON.parse(stdout)),
    catch: () =>
      new SignatureCheckFailed({
        reason: `Get-AuthenticodeSignature printed no valid result: ${stdout.slice(0, 500)}`,
      }),
  }).pipe(
    Effect.flatMap(({ Status, Path, Subject }) => {
      if (Status !== 0) return Effect.fail(new SignatureCheckFailed({ reason: `The signature status is ${Status}.` }));
      if (Path !== null && comparablePath(Path) !== comparablePath(file))
        return Effect.fail(new SignatureCheckFailed({ reason: `The checked file is ${Path}.` }));
      if (Subject === null)
        return Effect.fail(new SignatureCheckFailed({ reason: "The signature has no signer certificate." }));
      return Effect.succeed(Subject);
    }),
  );
}

/**
 * The rule of electron-updater 6.8.11: a publisher name that is a distinguished name matches when each
 * of its attributes equals the one of the signer; another name matches the signer's CN.
 */
function matchesPublisher(subject: string, publisherNames: readonly string[]): boolean {
  const signer = parseDn(subject);
  return publisherNames.some((name) => {
    const wanted = parseDn(name);
    if (wanted.size === 0) return name === signer.get("CN");
    return [...wanted].every(([key, value]) => signer.get(key) === value);
  });
}

/**
 * electron-updater's `verifyUpdateCodeSignature`: `null` when `file` is signed by one of
 * `publisherNames`, else the reason. Each failure, a timeout included, refuses the update.
 */
export const verifyWindowsUpdateSignature = Effect.fn("verifyWindowsUpdateSignature")(
  function* (publisherNames: readonly string[], file: string) {
    const stdout = yield* runSignatureScript(file);
    const subject = yield* parseSignature(stdout, file);
    if (matchesPublisher(subject, publisherNames)) return null;
    return `The installer is signed by "${subject}", not by ${publisherNames.join(" | ")}.`;
  },
  Effect.catch((error: SignatureCheckFailed) => Effect.succeed(error.reason)),
);

/**
 * `parseDn` of builder-util-runtime 9.7.0 (`rfc2253Parser.ts`, MIT, Copyright (c) 2015 Loopline
 * Systems), the parser that electron-updater 6.8.11 matches publisher names with. OpenBot does not
 * depend on builder-util-runtime directly.
 */
function parseDn(text: string): Map<string, string> {
  let quoted = false;
  let key: string | null = null;
  let token = "";
  let nextNonSpace = 0;
  const seq = text.trim();
  const result = new Map<string, string>();
  for (let i = 0; i <= seq.length; i++) {
    if (i === seq.length) {
      if (key !== null) result.set(key, token);
      break;
    }
    const ch = seq[i];
    if (quoted) {
      if (ch === '"') {
        quoted = false;
        continue;
      }
    } else {
      if (ch === '"') {
        quoted = true;
        continue;
      }
      if (ch === "\\") {
        i++;
        const ord = Number.parseInt(seq.slice(i, i + 2), 16);
        if (Number.isNaN(ord)) {
          token += seq[i] ?? "";
        } else {
          i++;
          token += String.fromCharCode(ord);
        }
        continue;
      }
      if (key === null && ch === "=") {
        key = token;
        token = "";
        continue;
      }
      if (ch === "," || ch === ";" || ch === "+") {
        if (key !== null) result.set(key, token);
        key = null;
        token = "";
        continue;
      }
    }
    if (ch === " " && !quoted) {
      if (token.length === 0) continue;
      if (i > nextNonSpace) {
        let j = i;
        while (seq[j] === " ") j++;
        nextNonSpace = j;
      }
      if (
        nextNonSpace >= seq.length ||
        seq[nextNonSpace] === "," ||
        seq[nextNonSpace] === ";" ||
        (key === null && seq[nextNonSpace] === "=") ||
        (key !== null && seq[nextNonSpace] === "+")
      ) {
        i = nextNonSpace - 1;
        continue;
      }
    }
    token += ch;
  }
  return result;
}
