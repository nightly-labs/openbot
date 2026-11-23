import { spawn } from "node:child_process";
import { join } from "node:path";
import { Effect } from "effect";

const RESTART_MARKER = "OPENBOT_WINDOWS_PACKAGE_RESTART";

export const restartOutsideWindowsPackage = Effect.fn("restartOutsideWindowsPackage")(function* (
  environment: NodeJS.ProcessEnv,
  argv: readonly string[],
  isLink: (value: string) => boolean,
) {
  const restarted = environment[RESTART_MARKER] !== undefined;
  delete environment[RESTART_MARKER];
  if (process.platform !== "win32" || !process.windowsStore || restarted) return false;
  const [link, ...rest] = argv.slice(1);
  const shellOpensInOpenBot = (value: string) => /^openbot:/i.test(value) && !value.includes(",") && isLink(value);
  if (rest.length > 0 || (link !== undefined && !shellOpensInOpenBot(link))) return false;
  const target = link ?? process.execPath;
  const explorer = join(environment.SystemRoot ?? environment.windir ?? "C:\\Windows", "explorer.exe");
  return yield* Effect.callback<boolean>((resume) => {
    const child = spawn(explorer, [target], {
      detached: true,
      stdio: "ignore",
      env: { ...environment, [RESTART_MARKER]: "1" },
    });
    child.once("error", () => resume(Effect.succeed(false)));
    child.once("spawn", () => {
      child.unref();
      resume(Effect.succeed(true));
    });
  });
});
