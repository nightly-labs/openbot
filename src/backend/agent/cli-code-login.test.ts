import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { Effect, Exit, Scope } from "effect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { runCauseEffect } from "../effect-boundary";
import { normalizePastedCode, parseCliCodePrompt, startCliCodeLogin } from "./cli-code-login";

// What the pinned CLIs printed with no browser, in an ubuntu:24.04 container (Grok 1.0.22 on
// stderr, Claude 2.1.263 under util-linux `script`). The PKCE values are shortened.
const GROK_OUTPUT = [
  "",
  "To sign in, open this URL in your browser:",
  "",
  "  https://accounts.x.ai/oauth2/device?user_code=6Z9Q-HAAK",
  "",
  "  (Could not open browser automatically — open the URL above manually.)",
  "",
  "Confirm this code in your browser:",
  "",
  "  6Z9Q-HAAK",
  "",
  "\u001b[90mOnly continue with a code you requested. Don't share it with anyone.\u001b[0m",
  "",
  "Waiting for authorization...",
].join("\n");
const CLAUDE_URL = "https://claude.com/cai/oauth/authorize?code=true&code_challenge=feIha1bB&state=wKR2LafO";
const CLAUDE_OUTPUT = `Opening browser to sign in…\r\nIf the browser didn't open, visit: \u001b]8;;${CLAUDE_URL}\u0007${CLAUDE_URL}\u001b]8;;\u0007\r\nPaste code here if prompted > `;

describe("parseCliCodePrompt", () => {
  it("reads the Grok device code only once its line is printed", () => {
    expect(parseCliCodePrompt("device", GROK_OUTPUT)).toEqual({
      flow: "device",
      userCode: "6Z9Q-HAAK",
      verificationUrl: "https://accounts.x.ai/oauth2/device",
      verificationUrlComplete: "https://accounts.x.ai/oauth2/device?user_code=6Z9Q-HAAK",
    });
    expect(parseCliCodePrompt("device", GROK_OUTPUT.slice(0, GROK_OUTPUT.indexOf("Confirm")))).toBeNull();
    expect(parseCliCodePrompt("device", GROK_OUTPUT.slice(0, GROK_OUTPUT.lastIndexOf("6Z9Q-HAAK") + 3))).toBeNull();
  });

  it("reads the Claude link out of its hyperlink only once the paste prompt shows", () => {
    expect(parseCliCodePrompt("paste", CLAUDE_OUTPUT)).toEqual({ flow: "paste", verificationUrl: CLAUDE_URL });
    expect(parseCliCodePrompt("paste", CLAUDE_OUTPUT.slice(0, CLAUDE_OUTPUT.indexOf("Paste")))).toBeNull();
  });
});

describe("normalizePastedCode", () => {
  it("refuses a code that would type a key into the CLI, with a message that does not quote it", () => {
    expect(normalizePastedCode("  abc#state \n")).toBe("abc#state");
    for (const code of ["", "part\rsecond", "x".repeat(2049)]) {
      expect(() => normalizePastedCode(code)).toThrow(sourceText("error.provider.codeLoginBadCode"));
    }
  });
});

describe("startCliCodeLogin", () => {
  let directory: string;
  let fakeClaude: string;
  const scopes: Scope.Closeable[] = [];
  afterEach(async () => {
    for (const scope of scopes.splice(0)) await Effect.runPromise(Scope.close(scope, Exit.void));
  });
  function start(options: Parameters<typeof startCliCodeLogin>[0]) {
    const scope = Scope.makeUnsafe();
    scopes.push(scope);
    return runCauseEffect(startCliCodeLogin(options).pipe(Effect.provideService(Scope.Scope, scope)));
  }

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "openbot-code-login-"));
    fakeClaude = join(directory, "claude.js");
    // Like the real CLI: it prints the link and the prompt, then reads one line. It quotes a refused
    // code, so a leak through its output would show.
    await writeFile(
      fakeClaude,
      `process.stdout.write(${JSON.stringify(CLAUDE_OUTPUT)});
let input = "";
process.stdin.on("data", (chunk) => {
  input += chunk;
  const end = input.search(/[\\r\\n]/);
  if (end < 0) return;
  const code = input.slice(0, end);
  if (code === "good-code") process.exit(0);
  process.stdout.write("Login failed: " + code + "\\r\\n");
  process.exit(1);
});
`,
    );
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  function login() {
    return start({
      flow: "paste",
      executable: process.execPath,
      argv: [fakeClaude],
      env: {},
      timeoutMs: 20_000,
    });
  }

  it.skipIf(process.platform !== "linux")("types a pasted code into the CLI's prompt on a terminal", async () => {
    const started = await login();
    expect(await runCauseEffect(started.prompt)).toEqual({ flow: "paste", verificationUrl: CLAUDE_URL });
    started.submit("good-code");
    await expect(runCauseEffect(started.done)).resolves.toBeUndefined();
  });

  it.skipIf(process.platform !== "linux")(
    "reports a refused code without quoting it, and masks it in logs",
    async () => {
      const started = await login();
      await runCauseEffect(started.prompt);
      const code = "refused-code-7Hq2#state";
      started.submit(code);
      await expect(runCauseEffect(started.done)).rejects.toThrow(sourceText("error.provider.codeLoginRefused"));
      expect(redactText(`Login failed: ${code}`)).not.toContain(code);
    },
  );

  it.skipIf(process.platform === "linux")("refuses a pasted-code sign-in off Linux", async () => {
    await expect(login()).rejects.toThrow(sourceText("error.provider.codeLoginUnsupported"));
  });

  it("stops a CLI that never finishes", async () => {
    const started = await start({
      flow: "device",
      executable: process.execPath,
      argv: ["-e", "setInterval(() => undefined, 1000)"],
      env: {},
      timeoutMs: 200,
    });
    await expect(runCauseEffect(started.done)).rejects.toThrow("timed out");
    await expect(runCauseEffect(started.prompt)).rejects.toThrow();
    expect(started.child.killed).toBe(true);
  });
});
