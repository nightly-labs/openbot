import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { Cause, Effect, Exit } from "effect";
import { accountCodeSignInOffered, type ProviderAccountActions } from "../packages/ui/src/components/provider-accounts";
import { startAcpAuthentication } from "../src/backend/acp-sign-in";
import { startCliCodeLogin } from "../src/backend/agent/cli-code-login";
import type { AgentCliInfo } from "../src/backend/cli";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import {
  type ProviderConnectRoute,
  providerConnectRoute,
} from "../src/renderer/src/features/provider-updates/provider-connect-route";

const OUT = resolve(import.meta.dirname, "../.openbot-build/gemini-linux-code-sign-in-e2e");
const REAL_CLI = process.env.OPENBOT_E2E_ANTIGRAVITY_CLI?.trim() || null;
const CODE = "4/0-openbot-e2e-code";
const PLATFORMS = ["linux", "darwin", "win32"] as const;

interface Report {
  passed: boolean;
  cli: "real" | "fake";
  routes: Partial<Record<(typeof PLATFORMS)[number], ProviderConnectRoute>>;
  accounts: Record<string, boolean>;
  noBrowserError: string | null;
  codeLogin: { flow: string | null; linkHost: string | null; browserOpened: boolean; submitted: string | null };
  cancel: { stopped: boolean };
  error?: string;
}

const report: Report = {
  passed: false,
  cli: REAL_CLI ? "real" : "fake",
  routes: {},
  accounts: {},
  noBrowserError: null,
  codeLogin: { flow: null, linkHost: null, browserOpened: false, submitted: null },
  cancel: { stopped: false },
};

const FAKE_CLI = (stdinFile: string) => `#!/bin/sh
if [ "$1" = "--version" ]; then echo 1.5.18; exit 0; fi
for arg in "$@"; do
  if [ "$arg" = "--login" ]; then
    if [ -z "$SSH_CONNECTION" ]; then xdg-open "https://accounts.google.com/o/oauth2/auth?client_id=e2e"; fi
    printf 'Open this link in a browser to log in with Google:\\n\\n  https://accounts.google.com/o/oauth2/auth?access_type=offline&client_id=e2e&state=s\\n\\nThen paste the authorization code, or the full URL of the page you land on, and press Enter:\\n'
    read -r code || exit 3
    printf '%s' "$code" > '${stdinFile}'
    exit 0
  fi
done
exit 2
`;

const accountActions = (overrides: Partial<ProviderAccountActions>): ProviderAccountActions => ({
  connect: async () => undefined,
  connectWithCode: async () => undefined,
  cancel: async () => undefined,
  rename: async () => undefined,
  remove: async () => undefined,
  ...overrides,
});

const root = await mkdtemp(join(tmpdir(), "openbot-gemini-linux-code-sign-in-e2e-"));

try {
  for (const platform of PLATFORMS) {
    report.routes[platform] = providerConnectRoute("antigravity", { kind: "computer", platform });
  }
  assert.deepEqual(report.routes.linux, { connect: "browser", alternative: "code", addressWhileSigningIn: true });
  assert.deepEqual(report.routes.darwin, { connect: "browser", alternative: null, addressWhileSigningIn: true });
  assert.deepEqual(report.routes.win32, { connect: "browser", alternative: "code", addressWhileSigningIn: false });
  assert.equal(providerConnectRoute("claude", { kind: "computer", platform: "linux" }).addressWhileSigningIn, false);

  report.accounts = {
    linuxComputer: accountCodeSignInOffered(
      "antigravity",
      accountActions({ pasteCodeSignIn: true, windowsCodeSignIn: false, local: true }),
    ),
    macComputer: accountCodeSignInOffered(
      "antigravity",
      accountActions({ pasteCodeSignIn: false, windowsCodeSignIn: false, local: true }),
    ),
    windowsComputer: accountCodeSignInOffered(
      "antigravity",
      accountActions({ pasteCodeSignIn: false, windowsCodeSignIn: true, local: true }),
    ),
    joinedServer: accountCodeSignInOffered("antigravity", accountActions({ pasteCodeSignIn: true })),
    claudeWindowsComputer: accountCodeSignInOffered(
      "claude",
      accountActions({ pasteCodeSignIn: false, windowsCodeSignIn: true, local: true }),
    ),
  };
  assert.deepEqual(report.accounts, {
    linuxComputer: true,
    macComputer: false,
    windowsComputer: true,
    joinedServer: false,
    claudeWindowsComputer: false,
  });

  const home = join(root, "home");
  const bin = join(root, "bin");
  const opened = join(root, "opened");
  const submitted = join(root, "submitted");
  await mkdir(home, { recursive: true });
  await mkdir(bin, { recursive: true });
  for (const name of ["xdg-open", "open"]) {
    await writeFile(join(bin, name), `#!/bin/sh\nprintf '%s\\n' "$1" >> '${opened}'\n`);
    await chmod(join(bin, name), 0o755);
  }
  const executable = REAL_CLI ?? join(root, "antigravity");
  if (!REAL_CLI) {
    await writeFile(executable, FAKE_CLI(submitted));
    await chmod(executable, 0o755);
  }
  const noDisplay: Record<string, string> = {
    HOME: home,
    PATH: `${bin}:/usr/bin:/bin`,
    GEMINI_HOME: join(home, ".gemini"),
  };
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, noDisplay);

  const driver = requireProviderDriver("antigravity");
  const codeSignIn = driver.codeSignIn;
  assert.ok(codeSignIn && codeSignIn.kind === "cli" && codeSignIn.flow === "paste");
  const cli: AgentCliInfo = { executable, version: "1.5.18", source: "managed" };

  if (REAL_CLI) {
    const signIn = driver.signIn;
    assert.equal(signIn.kind, "acp-authenticate");
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const login = yield* startAcpAuthentication({
            executable,
            argv: signIn.argv,
            env: { ...signIn.env },
            methodId: signIn.methodId,
            timeoutMs: 60_000,
            openSignInPage: { site: "google", open: async () => undefined },
          });
          return yield* login.done;
        }),
      ),
    );
    assert.ok(Exit.isFailure(exit), "Connect fails when the process has no display.");
    const failure = Cause.squash(exit.cause);
    const inner = failure instanceof Error && failure.cause instanceof Error ? failure.cause : failure;
    report.noBrowserError = inner instanceof Error ? inner.message : String(inner);
    assert.equal(report.noBrowserError, sourceText("error.provider.geminiNoBrowserUseCode"));
  }

  const command = codeSignIn.command;
  const argv = typeof command.argv === "function" ? await Effect.runPromise(command.argv(cli, "global")) : command.argv;
  const start = (submit: boolean) =>
    Effect.scoped(
      Effect.gen(function* () {
        const login = yield* startCliCodeLogin({
          flow: codeSignIn.flow,
          executable,
          argv,
          env: { ...command.env(cli, "global") },
          timeoutMs: 60_000,
          ...(command.pipedInput ? { pipedInput: true } : {}),
        });
        const prompt = yield* login.prompt;
        if (submit) {
          login.submit(CODE);
          yield* login.done;
        }
        return { prompt, child: login.child };
      }),
    );

  const first = await Effect.runPromise(start(!REAL_CLI));
  report.codeLogin.flow = first.prompt?.flow ?? null;
  report.codeLogin.linkHost = first.prompt ? new URL(first.prompt.verificationUrl).host : null;
  report.codeLogin.browserOpened = await readFile(opened, "utf8").then(
    (text) => text.length > 0,
    () => false,
  );
  report.codeLogin.submitted = await readFile(submitted, "utf8").catch(() => null);
  assert.equal(report.codeLogin.flow, "paste");
  assert.equal(report.codeLogin.linkHost, "accounts.google.com");
  assert.equal(report.codeLogin.browserOpened, false, "The code sign-in does not open a browser on this computer.");
  if (!REAL_CLI) assert.equal(report.codeLogin.submitted, CODE);

  const second = await Effect.runPromise(start(false));
  await Effect.runPromise(
    Effect.callback<void>((resume) => {
      if (second.child.exitCode !== null || second.child.signalCode !== null) return resume(Effect.void);
      second.child.once("exit", () => resume(Effect.void));
    }),
  );
  report.cancel.stopped = second.child.exitCode !== null || second.child.signalCode !== null;
  assert.ok(report.cancel.stopped, "Cancel stops the code sign-in process.");

  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  await rm(root, { recursive: true, force: true });
}

await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(report.passed ? 0 : 1);
