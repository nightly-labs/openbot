// Runs the real `SignInRelayClient` against a fake host whose `complete` waits until the check lets it
// go (#3243). A callback came back, by the listener or by a paste, and the host completes the sign-in:
// a paste of the same sign-in then must not say that the sign-in ended, must not send a second grant,
// and the host's result must still arrive. A paste before the callback, and after the end, keep their
// errors. The page opens with no click, also when no link chose it.
// `bun run test:sign-in-relay-paste`. Writes .openbot-build/sign-in-relay-paste-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { McpTestResult, SignInRelayStatus } from "@openbot/contracts/ipc";
import { sourceText, translateFor } from "@openbot/i18n";
import { Deferred, Effect } from "effect";
import { SignInRelayClient, type SignInRelayRemote } from "../src/main/sign-in-relay-client";

const OUT = resolve(import.meta.dirname, "../.openbot-build/sign-in-relay-paste-e2e");

const KEY = "server-1:codex";
const STATE = "relay-state";
/** No loopback `redirect_uri`, so the client binds no port and the callback comes by `deliver` or a paste. */
const PAGE = `https://auth.example/authorize?state=${STATE}`;
const CALLBACK = `http://127.0.0.1:1455/auth/callback?code=first&state=${STATE}`;
const SECOND_CALLBACK = `http://127.0.0.1:1455/auth/callback?code=second&state=${STATE}`;
const WRONG_STATE_CALLBACK = `http://127.0.0.1:1455/auth/callback?code=other&state=not-${STATE}`;
const SUCCESS: McpTestResult = { toolCount: 1, error: null };

interface CaseResult {
  name: string;
  opened: string[];
  wrongStateBefore: string | null;
  pageWhileCompleting: unknown;
  pasteWhileCompleting: string | null;
  wrongStateWhileCompleting: string | null;
  completeQueries: string[];
  result: McpTestResult;
  pasteAfterEnd: string | null;
}

interface Report {
  passed: boolean;
  cases: CaseResult[];
}

/** The message that `action` throws, or `null`. */
function thrown(action: () => void): string | null {
  try {
    action();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * One sign-in on a fake host. The callback comes back by `accept`. With `chosen`, a link chose the
 * page, as in a conversation; without it, the sign-in started from a dialog.
 */
async function runCase(
  name: string,
  accept: (client: SignInRelayClient) => void,
  chosen: boolean,
): Promise<CaseResult> {
  const opened: string[] = [];
  const completeQueries: string[] = [];
  const completing = Promise.withResolvers<void>();
  const release = Deferred.makeUnsafe<void>();
  const waiting = Promise.withResolvers<void>();
  let result: McpTestResult | null = null;
  let statusReads = 0;
  const status = (): SignInRelayStatus => ({ authorizeUrl: result ? null : PAGE, callback: null, result });
  const remote: SignInRelayRemote<never> = {
    start: Effect.succeed({ flowId: "flow-1" }),
    // The first read gives the page. The client reads again only after the sign-in waits for its callback.
    status: () =>
      Effect.sync(() => {
        statusReads += 1;
        if (!chosen && statusReads === 2) waiting.resolve();
        return status();
      }),
    complete: (_flowId, query) =>
      Effect.gen(function* () {
        completeQueries.push(query);
        completing.resolve();
        yield* Deferred.await(release);
        result = SUCCESS;
        return status();
      }),
    cancel: () => Effect.void,
  };
  const client = new SignInRelayClient({
    openExternal: async (url) => {
      opened.push(url);
    },
    language: { locale: "en", translate: translateFor("en") },
    ownListener: () => null,
  });
  const run = Effect.runPromise(
    client.run(KEY, remote, chosen ? { page: PAGE, onWaiting: () => waiting.resolve() } : null),
  );
  await waiting.promise;

  const wrongStateBefore = thrown(() => client.paste(KEY, WRONG_STATE_CALLBACK));
  accept(client);
  await completing.promise;
  const pageWhileCompleting = client.page(KEY);
  const pasteWhileCompleting = thrown(() => client.paste(KEY, SECOND_CALLBACK));
  const wrongStateWhileCompleting = thrown(() => client.paste(KEY, WRONG_STATE_CALLBACK));
  Deferred.doneUnsafe(release, Effect.void);
  const ended = await run;
  return {
    name,
    opened,
    wrongStateBefore,
    pageWhileCompleting,
    pasteWhileCompleting,
    wrongStateWhileCompleting,
    completeQueries,
    result: ended,
    pasteAfterEnd: thrown(() => client.paste(KEY, SECOND_CALLBACK)),
  };
}

const report: Report = { passed: false, cases: [] };
try {
  const deliver = (client: SignInRelayClient) => assert.ok(client.deliver(STATE, new URL(CALLBACK).search.slice(1)));
  const paste = (client: SignInRelayClient) => client.paste(KEY, CALLBACK);
  const cases: [string, (client: SignInRelayClient) => void, boolean][] = [
    ["listener callback, then paste", deliver, true],
    ["paste, then second paste", paste, true],
    ["dialog sign-in: listener callback, then paste", deliver, false],
    ["dialog sign-in: paste, then second paste", paste, false],
  ];
  for (const [name, accept, chosen] of cases) {
    const result = await runCase(name, accept, chosen);
    report.cases.push(result);
    assert.deepEqual(result.opened, [PAGE], `${result.name}: the page opens once, with no click.`);
    assert.equal(result.wrongStateBefore, sourceText("error.mcp.relayAddressInvalid"), `${result.name}: wrong state.`);
    assert.equal(result.pageWhileCompleting, null, `${result.name}: no page while the host completes.`);
    assert.equal(result.pasteWhileCompleting, null, `${result.name}: a paste while the host completes is no error.`);
    assert.equal(
      result.wrongStateWhileCompleting,
      sourceText("error.mcp.relayAddressInvalid"),
      `${result.name}: wrong state while the host completes.`,
    );
    assert.deepEqual(
      result.completeQueries,
      [new URL(CALLBACK).search.slice(1)],
      `${result.name}: only the first grant goes to the host.`,
    );
    assert.deepEqual(result.result, SUCCESS, `${result.name}: the host's result arrives.`);
    assert.equal(result.pasteAfterEnd, sourceText("error.mcp.relayEnded"), `${result.name}: a paste after the end.`);
  }
  report.passed = true;
} finally {
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
