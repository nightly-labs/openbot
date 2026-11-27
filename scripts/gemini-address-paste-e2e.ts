import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AgentProviderId } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { startAcpAuthentication } from "../src/backend/acp-sign-in";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { LocalSignInPages } from "../src/main/local-sign-in-pages";

const OUT = resolve(import.meta.dirname, "../.openbot-build/gemini-address-paste-e2e");
const STATE = "gemini-state";

const FAKE_AGENT = `
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize")
    send({ id: message.id, result: { protocolVersion: 1, agentCapabilities: { auth: {} }, authMethods: [{ id: "oauth-personal", name: "Google" }] } });
  if (message.method !== "authenticate") return;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/auth/callback" || url.searchParams.get("state") !== "${STATE}") return response.writeHead(404).end();
    response.writeHead(200).end("Done");
    if (url.searchParams.get("code") === "grant") send({ id: message.id, result: {} });
    else send({ id: message.id, error: { code: -32000, message: "Sign-in was refused." } });
  });
  server.listen(0, "localhost", () => {
    const redirect = "http://localhost:" + server.address().port + "/auth/callback";
    const page = "https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=" + encodeURIComponent(redirect) + "&state=${STATE}&response_type=code";
    spawn(process.platform === "darwin" ? "open" : "xdg-open", [page], { stdio: "ignore" });
  });
});
`;

interface PasteCase {
  name: string;
  refusals: Record<string, string | null>;
  delivered: boolean;
  signInError: string | null;
  afterEnd: string | null;
}

async function pasteError(
  pages: LocalSignInPages,
  address: string,
  provider: AgentProviderId = "antigravity",
): Promise<string | null> {
  try {
    await runCauseEffect(pages.paste(provider, address));
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function signIn(name: string, fake: string, query: string): Promise<PasteCase> {
  const result: PasteCase = { name, refusals: {}, delivered: false, signInError: null, afterEnd: null };
  let signingIn = true;
  const pages = new LocalSignInPages(() => signingIn);
  const open = async (page: string) => {
    pages.opened("antigravity", page);
    const callback = new URL(new URL(page).searchParams.get("redirect_uri") ?? "");
    const safari = `https://${callback.host}${callback.pathname}`;
    result.refusals.wrongState = await pasteError(pages, `${safari}?code=grant&state=other`);
    result.refusals.noCode = await pasteError(pages, `${safari}?state=${STATE}`);
    result.refusals.notAnAddress = await pasteError(pages, "Gemini");
    result.delivered = (await pasteError(pages, `${safari}?${query}&state=${STATE}`)) === null;
  };
  const exit = await Effect.runPromiseExit(
    Effect.scoped(
      Effect.gen(function* () {
        const login = yield* startAcpAuthentication({
          executable: process.execPath,
          argv: [fake],
          env: {},
          methodId: "oauth-personal",
          timeoutMs: 20_000,
          openSignInPage: { site: "google", open },
        });
        yield* login.done;
      }),
    ),
  );
  signingIn = false;
  if (exit._tag === "Failure") result.signInError = exit.cause.toString().slice(0, 300);
  result.afterEnd = await pasteError(pages, `https://localhost:1/auth/callback?code=grant&state=${STATE}`);
  return result;
}

const report: {
  passed: boolean;
  gates: Record<string, string | null>;
  cases: PasteCase[];
} = { passed: false, gates: {}, cases: [] };
try {
  const invalid = sourceText("error.mcp.relayAddressInvalid");
  const ended = sourceText("error.mcp.relayEnded");
  const page = `https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=${encodeURIComponent("http://localhost:4000/auth/callback")}&state=${STATE}`;
  const windows = new LocalSignInPages(() => true, "win32");
  windows.opened("antigravity", page);
  const codex = new LocalSignInPages(() => true, "darwin");
  codex.opened("codex", page);
  const address = `https://localhost:4000/auth/callback?code=grant&state=${STATE}`;
  report.gates = {
    windows: await pasteError(windows, address),
    otherProvider: await pasteError(codex, address, "codex"),
  };
  assert.equal(report.gates.windows, ended, "Windows keeps its own sign-in and takes no pasted address.");
  assert.equal(report.gates.otherProvider, ended, "Only the Gemini sign-in takes a pasted address.");

  await mkdir(OUT, { recursive: true });
  const fake = join(OUT, "fake-antigravity-acp.mjs");
  await writeFile(fake, FAKE_AGENT);

  const granted = await signIn("Safari address of a granted sign-in", fake, "code=grant");
  report.cases.push(granted);
  assert.equal(granted.refusals.wrongState, invalid, "An address of another sign-in is refused.");
  assert.equal(granted.refusals.noCode, invalid, "An address with no sign-in result is refused.");
  assert.equal(granted.refusals.notAnAddress, invalid, "Text that is not an address is refused.");
  assert.equal(granted.delivered, true, "The pasted address reaches the runtime's own listener.");
  assert.equal(granted.signInError, null, "The sign-in ends signed in.");
  assert.equal(granted.afterEnd, ended, "A paste after the end of the sign-in is refused.");

  const refused = await signIn("Safari address of a refused sign-in", fake, "error=access_denied");
  report.cases.push(refused);
  assert.equal(refused.delivered, true, "A refusal reaches the runtime too.");
  assert.notEqual(refused.signInError, null, "A refused sign-in ends with an error.");
  report.passed = true;
} finally {
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
