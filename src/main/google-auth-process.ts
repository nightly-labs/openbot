import { type ChildProcess, spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { isGoogleConnectionPage, type McpServerConfig } from "@openbot/contracts/ipc";
import { registerSecretValue } from "@openbot/logging";
import type { GoogleConnectionsConfig } from "./google-connections-store";

const PROFILE = /^[A-Za-z0-9_-]{1,64}$/u;
interface GoogleCredential {
  clientId: string;
  clientSecret: string;
  email: string;
  tokens: { refresh_token: string; access_token?: string };
}
/** Reads only a profile selected by trusted host configuration, never a caller-supplied path. */
export async function readGoogleCredential(home: string, profile: string): Promise<GoogleCredential> {
  if (!PROFILE.test(profile)) throw new Error("Invalid Google profile.");
  const file = join(home, profile, "credentials.json");
  const st = await lstat(file);
  if (!st.isFile() || st.isSymbolicLink() || (st.mode & 0o077) !== 0 || st.size > 128 * 1024)
    throw new Error("Invalid Google credential file.");
  const v = JSON.parse(await readFile(file, "utf8"));
  if (
    typeof v.clientId !== "string" ||
    typeof v.clientSecret !== "string" ||
    typeof v.email !== "string" ||
    !v.email ||
    typeof v.tokens?.refresh_token !== "string"
  )
    throw new Error("Incomplete Google profile.");
  registerSecretValue(v.clientSecret);
  registerSecretValue(v.tokens.refresh_token);
  if (typeof v.tokens.access_token === "string") registerSecretValue(v.tokens.access_token);
  return v;
}
/** An administrator opts in with an existing installed, reviewed Google CLI entry. */
export async function googleConfigFromTemplate(mcp: McpServerConfig): Promise<GoogleConnectionsConfig> {
  if (
    mcp.transport !== "stdio" ||
    !isAbsolute(mcp.command) ||
    !["node", "node.exe"].includes(basename(mcp.command)) ||
    mcp.args.length !== 4 ||
    mcp.args[1] !== "serve" ||
    mcp.args[2] !== "--profile" ||
    !PROFILE.test(mcp.args[3] ?? "")
  )
    throw new Error("Choose an installed Google connector.");
  const cliPath = resolve(mcp.args[0] ?? "");
  if (!isAbsolute(mcp.args[0] ?? "") || basename(cliPath) !== "cli.js" || basename(dirname(cliPath)) !== "dist")
    throw new Error("Choose an installed Google connector.");
  const pkg = JSON.parse(await readFile(join(dirname(dirname(cliPath)), "package.json"), "utf8"));
  if (pkg.name !== "openbot-google-plugin") throw new Error("Choose an installed Google connector.");
  const home = mcp.env.find((e) => e.key === "OPENBOT_GOOGLE_HOME")?.value;
  if (!home || !isAbsolute(home)) throw new Error("Google connector needs a private profile directory.");
  const credential = await readGoogleCredential(home, mcp.args[3] ?? "");
  return {
    templateMcpServerId: mcp.id,
    command: mcp.command,
    cliPath,
    home: resolve(home),
    clientId: credential.clientId,
    clientSecret: credential.clientSecret,
  };
}
export interface GoogleAuthAttempt {
  ready: Promise<string>;
  done: Promise<{ ok: boolean; timedOut: boolean }>;
  cancel: () => Promise<void>;
}
function verifiedPage(value: string, config: GoogleConnectionsConfig): string {
  if (!isGoogleConnectionPage(value) || new URL(value).searchParams.get("client_id") !== config.clientId)
    throw new Error("Unexpected Google sign-in page.");
  return new URL(value).toString();
}
/** Runs only the trusted Google auth CLI. Its client file and process are owned by this attempt. */
export async function startGoogleAuth(config: GoogleConnectionsConfig, profile: string): Promise<GoogleAuthAttempt> {
  if (!PROFILE.test(profile)) throw new Error("Invalid Google profile.");
  await mkdir(config.home, { recursive: true, mode: 0o700 });
  const temp = await mkdtemp(join(config.home, ".signin-"));
  const clientFile = join(temp, "client.json");
  let child: ChildProcess;
  try {
    await writeFile(
      clientFile,
      JSON.stringify({ installed: { client_id: config.clientId, client_secret: config.clientSecret } }),
      { mode: 0o600, flag: "wx" },
    );
    child = spawn(config.command, [config.cliPath, "auth", "--client", clientFile, "--profile", profile], {
      env: { ...process.env, OPENBOT_GOOGLE_HOME: config.home },
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    throw error;
  }
  let readyResolve!: (url: string) => void;
  let readyReject!: (e: Error) => void;
  let finish!: (v: { ok: boolean; timedOut: boolean }) => void;
  const ready = new Promise<string>((yes, no) => {
    readyResolve = yes;
    readyReject = no;
  });
  const done = new Promise<{ ok: boolean; timedOut: boolean }>((yes) => {
    finish = yes;
  });
  void ready.catch(() => {});
  let output = "";
  let found = false;
  let ended = false;
  const timer = setTimeout(() => {
    readyReject(new Error("Google sign-in did not start."));
    child.kill("SIGTERM");
  }, 15_000);
  timer.unref();
  const close = async (code: number | null) => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    if (!found) readyReject(new Error("Google sign-in did not start."));
    let cleaned = true;
    try {
      await rm(temp, { recursive: true, force: true });
    } catch {
      cleaned = false;
    }
    finish({ ok: code === 0 && cleaned, timedOut: output.includes("Google sign-in timed out.") });
  };
  child.stderr?.on("data", (chunk: Buffer) => {
    output = (output + chunk.toString("utf8")).slice(0, 32769);
    if (output.length > 32 * 1024) {
      readyReject(new Error("Invalid Google sign-in output."));
      child.kill("SIGTERM");
      return;
    }
    if (found) return;
    const line = output.split(/\r?\n/u).find((v) => v.startsWith("https://accounts.google.com/"));
    // The CLI writes a complete URL followed by a newline. Do not parse an incomplete chunk.
    if (!line || !output.includes(`${line}\n`)) return;
    try {
      const page = verifiedPage(line, config);
      found = true;
      clearTimeout(timer);
      readyResolve(page);
    } catch {
      readyReject(new Error("Unexpected Google sign-in page."));
      child.kill("SIGTERM");
    }
  });
  child.once("error", () => {
    void close(1);
  });
  child.once("close", (code) => {
    void close(code);
  });
  return {
    ready,
    done,
    cancel: async () => {
      if (!ended) {
        child.kill("SIGTERM");
        const hard = setTimeout(() => child.kill("SIGKILL"), 3000);
        hard.unref();
        await done;
        clearTimeout(hard);
      }
    },
  };
}
