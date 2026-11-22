import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loopbackCallback } from "@openbot/contracts/ipc";
import {
  legacyTeamCapabilities,
  teamCapabilitiesForProtocol,
  teamCapabilitiesVisibleToProtocol,
} from "@openbot/contracts/team-protocol/current";
import { optionalRouteCodec } from "@openbot/contracts/team-protocol/optional-routes";
import {
  PROVIDER_SIGN_IN_RELAY_V2_CAPABILITY,
  PROVIDER_SIGN_IN_RELAY_V2_ROUTES,
} from "@openbot/contracts/team-protocol/provider-sign-in-relay-v2";
import { providerSignInRelay } from "@openbot/contracts/team-protocol/provider-sign-in-relays";
import { SIGN_IN_RELAY_CAPABILITY, SIGN_IN_RELAY_ROUTES } from "@openbot/contracts/team-protocol/sign-in-relay-v1";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { startAcpAuthentication } from "../src/backend/acp-sign-in";
import { SignInRelayHost } from "../src/main/sign-in-relay-host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/devin-sign-in-relay-e2e");
const MEMBER = "member-1";

const FAKE_AGENT = `
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
const origin = process.argv[2];
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize")
    send({ id: message.id, result: { protocolVersion: 1, agentCapabilities: { auth: {} }, authMethods: [{ id: "devin-browser", name: "Sign in" }] } });
  if (message.method !== "authenticate") return;
  const state = "devin-state";
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/callback" || url.searchParams.get("state") !== state) return response.writeHead(404).end();
    response.writeHead(200).end("Signed in");
    send({ id: message.id, result: {} });
  });
  server.listen(0, "127.0.0.1", () => {
    const redirect = "http://127.0.0.1:" + server.address().port + "/callback";
    const page = origin + "/auth/cli/continue?redirect_uri=" + encodeURIComponent(redirect) + "&state=" + state + "&code_challenge=x&code_challenge_method=S256";
    spawn("xdg-open", [page], { stdio: "ignore" });
  });
});
`;

interface SignInCase {
  name: string;
  pageOrigin: string | null;
  callback: { port: number; path: string; state: string | null } | null;
  replayed: boolean;
  error: string | null;
}

async function signIn(name: string, fake: string, origin: string): Promise<SignInCase> {
  const result: SignInCase = { name, pageOrigin: null, callback: null, replayed: false, error: null };
  const host = new SignInRelayHost({
    mcp: { startRelay: unused },
    providers: { startRelay: unused, relayStatus: noPage, cancel: unused },
    accounts: { startRelay: unused, relayStatus: noPage, cancelSignIn: unused },
    receiveMcpGrant: () => false,
    receiveMcpRefusal: () => false,
    cancelMcpSignInPage: () => false,
    printedLink: () => false,
  });
  let finished = false;
  const open = async (page: string) => {
    result.pageOrigin = new URL(page).origin;
    result.callback = loopbackCallback(page);
    const { flowId } = host.startReplay(MEMBER, {
      key: "provider\ndevin",
      status: () => ({ pageUrl: page, result: finished ? { toolCount: 0, error: null } : null }),
      cancel: () => Effect.void,
    });
    const state = new URL(page).searchParams.get("state");
    await Effect.runPromise(host.complete(MEMBER, flowId, `code=grant&state=${state}`));
    result.replayed = true;
  };
  const exit = await Effect.runPromiseExit(
    Effect.scoped(
      Effect.gen(function* () {
        const login = yield* startAcpAuthentication({
          executable: process.execPath,
          argv: [fake, origin],
          env: {},
          methodId: "devin-browser",
          timeoutMs: 20_000,
          openSignInPage: { site: "devin", open },
        });
        yield* login.done;
      }),
    ),
  );
  finished = exit._tag === "Success";
  if (exit._tag === "Failure") {
    const failure = exit.cause.toString();
    result.error = failure.includes(sourceText("error.provider.acpSignInFailed"))
      ? sourceText("error.provider.acpSignInFailed")
      : failure.slice(0, 300);
  }
  return result;
}

function unused(): Effect.Effect<never> {
  return Effect.die(new Error("A replay does not start a sign-in."));
}

function noPage() {
  return { pageUrl: null, result: null };
}

function refuses(path: string, body: unknown): boolean {
  try {
    optionalRouteCodec(path)?.request(body);
    return false;
  } catch {
    return true;
  }
}

const report: {
  passed: boolean;
  wire: Record<string, boolean | string | null>;
  cases: SignInCase[];
} = { passed: false, wire: {}, cases: [] };
try {
  if (process.platform !== "linux") throw new Error("Only a Linux host advertises the capability.");
  const v1Only = (capability: string) => capability === SIGN_IN_RELAY_CAPABILITY;
  const both = (capability: string) =>
    capability === SIGN_IN_RELAY_CAPABILITY || capability === PROVIDER_SIGN_IN_RELAY_V2_CAPABILITY;
  report.wire = {
    v1RefusesDevin: refuses(SIGN_IN_RELAY_ROUTES.providerStart, { provider: "devin" }),
    v2TakesDevin: !refuses(PROVIDER_SIGN_IN_RELAY_V2_ROUTES.start, { provider: "devin" }),
    v2RefusesCodex: refuses(PROVIDER_SIGN_IN_RELAY_V2_ROUTES.start, { provider: "codex" }),
    protocol9HostLeavesItOut: !teamCapabilitiesVisibleToProtocol([PROVIDER_SIGN_IN_RELAY_V2_CAPABILITY], 9).length,
    protocol9ListLeavesItOut: !teamCapabilitiesForProtocol(9).includes(PROVIDER_SIGN_IN_RELAY_V2_CAPABILITY),
    protocol10ListHasIt: teamCapabilitiesForProtocol(10).includes(PROVIDER_SIGN_IN_RELAY_V2_CAPABILITY),
    legacyPeersDoNotGetIt: !legacyTeamCapabilities([PROVIDER_SIGN_IN_RELAY_V2_CAPABILITY]).length,
    olderHostRoute: providerSignInRelay("devin", v1Only)?.relay.start ?? null,
    newHostRoute: providerSignInRelay("devin", both)?.relay.start ?? null,
    codexRoute: providerSignInRelay("codex", both)?.relay.start ?? null,
  };
  assert.equal(report.wire.v1RefusesDevin, true, "The frozen v1 route does not change.");
  assert.equal(report.wire.v2TakesDevin, true, "The v2 route takes Devin.");
  assert.equal(report.wire.v2RefusesCodex, true, "The v2 route takes only its own providers.");
  assert.equal(report.wire.protocol9HostLeavesItOut, true, "A host does not send it to a protocol 9 peer.");
  assert.equal(report.wire.protocol9ListLeavesItOut, true, "A protocol 9 peer does not get it.");
  assert.equal(report.wire.protocol10ListHasIt, true, "A protocol 10 peer gets it.");
  assert.equal(report.wire.legacyPeersDoNotGetIt, true, "A peer below protocol 9 does not get it.");
  assert.equal(report.wire.olderHostRoute, null, "An older host offers no Devin sign-in.");
  assert.equal(report.wire.newHostRoute, PROVIDER_SIGN_IN_RELAY_V2_ROUTES.start, "A new host relays Devin on v2.");
  assert.equal(report.wire.codexRoute, SIGN_IN_RELAY_ROUTES.providerStart, "Codex keeps the v1 route.");

  await mkdir(OUT, { recursive: true });
  const fake = join(OUT, "fake-devin-acp.mjs");
  await writeFile(fake, FAKE_AGENT);

  const devin = await signIn("Devin page, relayed callback", fake, "https://app.devin.ai");
  report.cases.push(devin);
  assert.equal(devin.pageOrigin, "https://app.devin.ai", "OpenBot gets the page, not a browser on the host.");
  assert.equal(devin.callback?.path, "/callback", "The page returns to the CLI's loopback listener.");
  assert.equal(devin.callback?.state, "devin-state", "The relay knows the state of the page.");
  assert.equal(devin.replayed, true, "The host replays the client's callback to the CLI.");
  assert.equal(devin.error, null, "The sign-in ends signed in.");

  const other = await signIn("Page of another site", fake, "https://devin.example");
  report.cases.push(other);
  assert.equal(other.pageOrigin, null, "OpenBot does not pass on a page of another site.");
  assert.equal(other.error, sourceText("error.provider.acpSignInFailed"), "The sign-in fails with a plain text.");
  report.passed = true;
} finally {
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
