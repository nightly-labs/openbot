import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerSecretValue } from "@openbot/logging";
import { Duration, Effect } from "effect";
import { CliLoginFailed } from "./cli-login-flow";

const POLL = Duration.millis(250);

export function signInPageByOpenBot(
  onHost: boolean,
  command: { readonly windowsPageByOpenBot?: true },
  platform: NodeJS.Platform = process.platform,
): boolean {
  return onHost || (platform === "win32" && command.windowsPageByOpenBot === true);
}

export const captureBrowser = Effect.fn("captureBrowser")(function* (openPage: (url: string) => Promise<void>) {
  const directory = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () => mkdtemp(join(tmpdir(), "openbot-sign-in-")),
      catch: (cause) => new CliLoginFailed({ cause }),
    }),
    (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
  );
  const page = join(directory, "page");
  const windows = process.platform === "win32";
  const command = join(directory, windows ? "browser.cmd" : "browser.sh");
  yield* Effect.tryPromise({
    try: async () => {
      await writeFile(command, windows ? windowsScript() : posixScript(page), { mode: 0o700 });
      await chmod(command, 0o700);
    },
    catch: (cause) => new CliLoginFailed({ cause }),
  });
  yield* Effect.forkScoped(
    Effect.gen(function* () {
      while (true) {
        const url = yield* Effect.promise(() => readFile(page, "utf8").then(firstPage, () => null));
        if (url) {
          registerSecretValue(url);
          return yield* Effect.promise(() => openPage(url).catch(() => undefined));
        }
        yield* Effect.sleep(POLL);
      }
    }),
  );
  return { BROWSER: command };
});

function firstPage(text: string): string | null {
  for (const line of text.split(/\r?\n/u)) {
    const url = URL.parse(line.trim());
    if (url?.protocol === "https:" && !url.username && !url.password) return url.toString();
  }
  return null;
}

function posixScript(page: string): string {
  return `#!/bin/sh\nprintf '%s\\n' "$1" >> '${page.replaceAll("'", `'\\''`)}'\n`;
}

function windowsScript(): string {
  return `@echo off\r\nsetlocal EnableDelayedExpansion\r\nset "address=%~1"\r\n>>"%~dp0page" echo(!address!\r\n`;
}
