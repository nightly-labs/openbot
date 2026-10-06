import { type ParseArgsOptionsConfig, parseArgs } from "node:util";
import { redactText } from "@openbot/logging";

// One strict parser for the dev scripts that change or read developer state. A
// script that ignored a flag it did not know used to run anyway, so a mistyped
// option or `--help` could seed or reset the shared dev profile. Here an
// unknown flag is an error and `--help` stops before the script does anything.

const HELP_OPTION = { help: { type: "boolean", short: "h" } } as const satisfies ParseArgsOptionsConfig;

export interface ScriptArgumentsSpec<Options extends ParseArgsOptionsConfig> {
  usage: string;
  options: Options;
  /** How many positionals the script takes. Defaults to none. */
  maxPositionals?: number;
}

/**
 * Parses `process.argv` for a script entry point. Returns
 * `null` after it prints the usage for `--help`; the caller then returns before
 * any side effect. An unknown option, a missing value, or an unexpected
 * positional prints the usage and exits with code 2.
 */
export function readScriptArguments<const Options extends ParseArgsOptionsConfig>(spec: ScriptArgumentsSpec<Options>) {
  let parsed: ReturnType<
    typeof parseArgs<{ options: Options & typeof HELP_OPTION; strict: true; allowPositionals: true }>
  >;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      options: { ...spec.options, ...HELP_OPTION },
      strict: true,
      allowPositionals: true,
    });
    const extra = parsed.positionals[spec.maxPositionals ?? 0];
    if (extra !== undefined) throw new Error(`Unexpected argument '${extra}'.`);
  } catch (error) {
    // The message repeats what was typed, which can be a token pasted in the wrong place.
    process.stderr.write(`${redactText(error instanceof Error ? error.message : String(error))}\n\n${spec.usage}\n`);
    process.exit(2);
  }
  // A boolean option is present in `values` only when it was passed.
  if ("help" in parsed.values) {
    process.stdout.write(`${spec.usage}\n`);
    return null;
  }
  return parsed;
}
