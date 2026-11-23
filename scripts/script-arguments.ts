import { type ParseArgsOptionsConfig, parseArgs } from "node:util";
import { redactText } from "@openbot/logging";

const HELP_OPTION = { help: { type: "boolean", short: "h" } } as const satisfies ParseArgsOptionsConfig;

export interface ScriptArgumentsSpec<Options extends ParseArgsOptionsConfig> {
  usage: string;
  options: Options;
  maxPositionals?: number;
}

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
    process.stderr.write(`${redactText(error instanceof Error ? error.message : String(error))}\n\n${spec.usage}\n`);
    process.exit(2);
  }
  if ("help" in parsed.values) {
    process.stdout.write(`${spec.usage}\n`);
    return null;
  }
  return parsed;
}
